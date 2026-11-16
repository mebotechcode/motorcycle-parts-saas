-- =====================================================================
-- Phase 2 / 11 — Core automation
--   * new user  -> profile row
--   * tenant_id automatically filled from the login token on insert
--   * stock movement -> stock_levels (running balance)
--   * payments -> sale.amount_paid + customer debt ledger
--   * completed / changed / voided sales -> customer debt ledger
--   * audit trail for sensitive changes
--   * next_document_number() for receipts, POs, transfers, returns
-- Trigger functions are SECURITY DEFINER so they can write to tables
-- that normal users are (deliberately) not allowed to write directly.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Profile for every new auth user
-- ---------------------------------------------------------------------
create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, full_name, phone)
  values (new.id,
          coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
          new.phone)
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- ---------------------------------------------------------------------
-- 2. tenant_id defaults to the logged-in user's business, so the app never
--    has to send it (RLS still rejects a wrong value).
-- ---------------------------------------------------------------------
do $$
declare r record;
begin
  for r in
    select c.table_name
      from information_schema.columns c
      join information_schema.tables t
        on t.table_schema = c.table_schema and t.table_name = c.table_name
     where c.table_schema = 'public' and c.column_name = 'tenant_id'
       and t.table_type = 'BASE TABLE'
  loop
    execute format('alter table public.%I alter column tenant_id set default private.tenant_id()',
                   r.table_name);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 3. Stock movements keep stock_levels up to date
--    (Negative stock is allowed: shops often sell before the delivery is
--     entered. A per-tenant "block negative stock" setting can come later.)
-- ---------------------------------------------------------------------
create or replace function private.apply_stock_movement()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_balance numeric;
begin
  if exists (select 1 from public.products p
              where p.id = new.product_id and p.tenant_id = new.tenant_id and p.track_stock = false) then
    return new;     -- services / untracked items: nothing to keep
  end if;

  insert into public.stock_levels (tenant_id, branch_id, product_id, quantity)
  values (new.tenant_id, new.branch_id, new.product_id, new.quantity)
  on conflict (branch_id, product_id)
  do update set quantity = public.stock_levels.quantity + excluded.quantity,
                updated_at = now()
  returning quantity into v_balance;

  new.balance_after := v_balance;
  return new;
end $$;

drop trigger if exists trg_apply_stock_movement on public.stock_movements;
create trigger trg_apply_stock_movement
  before insert on public.stock_movements
  for each row execute function private.apply_stock_movement();

-- ---------------------------------------------------------------------
-- 4. Customer debt ledger from sales
--    Completed sale with a customer  => debit  +total
--    Total changed afterwards        => adjustment (difference)
--    Sale voided                     => adjustment -total
--    Each payment                    => credit (see section 5)
--    So balance = what the customer still owes.
-- ---------------------------------------------------------------------
create or replace function private.sale_to_ledger()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.customer_id is null then
    return new;
  end if;

  if new.status = 'completed'
     and (tg_op = 'INSERT' or old.status is distinct from 'completed')
     and new.total <> 0 then
    insert into public.customer_ledger
      (tenant_id, customer_id, branch_id, entry_type, amount, sale_id, note, created_by)
    values (new.tenant_id, new.customer_id, new.branch_id, 'sale', new.total, new.id,
            'Sale ' || coalesce(new.receipt_no, ''), auth.uid());

  elsif tg_op = 'UPDATE' and old.status = 'completed' and new.status = 'completed'
        and new.total is distinct from old.total then
    insert into public.customer_ledger
      (tenant_id, customer_id, branch_id, entry_type, amount, sale_id, note, created_by)
    values (new.tenant_id, new.customer_id, new.branch_id, 'adjustment',
            new.total - old.total, new.id,
            'Sale total changed ' || coalesce(new.receipt_no, ''), auth.uid());

  elsif tg_op = 'UPDATE' and old.status = 'completed' and new.status = 'voided' and old.total <> 0 then
    insert into public.customer_ledger
      (tenant_id, customer_id, branch_id, entry_type, amount, sale_id, note, created_by)
    values (new.tenant_id, new.customer_id, new.branch_id, 'adjustment',
            -old.total, new.id,
            'Sale voided ' || coalesce(new.receipt_no, ''), auth.uid());
  end if;
  return new;
end $$;

drop trigger if exists trg_sale_to_ledger on public.sales;
create trigger trg_sale_to_ledger
  after insert or update on public.sales
  for each row execute function private.sale_to_ledger();

-- ---------------------------------------------------------------------
-- 5. Payments update the sale and the customer's ledger
-- ---------------------------------------------------------------------
create or replace function private.payment_applied()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_customer uuid := new.customer_id;
begin
  if new.sale_id is not null then
    update public.sales
       set amount_paid = amount_paid + new.amount
     where tenant_id = new.tenant_id and id = new.sale_id
    returning coalesce(v_customer, customer_id) into v_customer;
  end if;

  if v_customer is not null then
    insert into public.customer_ledger
      (tenant_id, customer_id, branch_id, entry_type, amount, sale_id, payment_id, note, created_by)
    values (new.tenant_id, v_customer, new.branch_id, 'payment', -new.amount,
            new.sale_id, new.id,
            case new.kind when 'debt_repayment' then 'Debt repayment' else 'Sale payment' end
              || coalesce(' ' || new.reference, ''),
            auth.uid());
  end if;
  return new;
end $$;

drop trigger if exists trg_payment_applied on public.payments;
create trigger trg_payment_applied
  after insert on public.payments
  for each row execute function private.payment_applied();

-- ---------------------------------------------------------------------
-- 6. Audit trail (who changed what). Only meaningful changes are logged.
-- ---------------------------------------------------------------------
create or replace function private.audit_row()
returns trigger language plpgsql security definer set search_path = '' as $$
declare r jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
begin
  insert into public.audit_logs (tenant_id, user_id, action, table_name, record_id, old_data, new_data)
  values ((r ->> 'tenant_id')::uuid, auth.uid(), lower(tg_op), tg_table_name, r ->> 'id',
          case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
          case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end);
  return null;
end $$;

-- price / cost changes and deletions of products
create trigger audit_products_update after update on public.products
  for each row when (old.selling_price is distinct from new.selling_price
                  or old.wholesale_price is distinct from new.wholesale_price
                  or old.min_selling_price is distinct from new.min_selling_price
                  or old.cost_price is distinct from new.cost_price
                  or old.deleted_at is distinct from new.deleted_at)
  execute function private.audit_row();
create trigger audit_products_delete after delete on public.products
  for each row execute function private.audit_row();

-- credit limit changes and deletions of customers
create trigger audit_customers_update after update on public.customers
  for each row when (old.credit_limit is distinct from new.credit_limit
                  or old.deleted_at is distinct from new.deleted_at)
  execute function private.audit_row();
create trigger audit_customers_delete after delete on public.customers
  for each row execute function private.audit_row();

-- voids, total/discount changes, deletions of sales
create trigger audit_sales_update after update on public.sales
  for each row when (old.status is distinct from new.status
                  or old.total is distinct from new.total
                  or old.discount_total is distinct from new.discount_total)
  execute function private.audit_row();
create trigger audit_sales_delete after delete on public.sales
  for each row execute function private.audit_row();

-- returns, stock adjustments / damage / supplier returns
create trigger audit_sale_returns_insert after insert on public.sale_returns
  for each row execute function private.audit_row();
create trigger audit_stock_adjustments after insert on public.stock_movements
  for each row when (new.movement_type in ('adjustment','damage','supplier_return'))
  execute function private.audit_row();

-- staff role / access changes, expenses edits
create trigger audit_members_all after insert or update or delete on public.tenant_members
  for each row execute function private.audit_row();
create trigger audit_expenses_change after update or delete on public.expenses
  for each row execute function private.audit_row();

-- ---------------------------------------------------------------------
-- 7. Document numbers: NRB-000123 (receipt), RT-NRB-000007 (return),
--    PO-000045 (purchase order), TR-000012 (transfer).
--    Receipts/returns count per branch; PO/transfer count per business.
-- ---------------------------------------------------------------------
create or replace function public.next_document_number(p_doc_type text, p_branch_id uuid default null)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_tenant uuid := private.tenant_id();
  v_code   text;
  v_n      bigint;
begin
  if v_tenant is null then
    raise exception 'No active business' using errcode = '42501';
  end if;
  if not private.tenant_writable() then
    raise exception 'This business subscription is not active' using errcode = '42501';
  end if;

  if p_doc_type in ('receipt', 'return') then
    if p_branch_id is null or not private.can_access_branch(p_branch_id) then
      raise exception 'You do not have access to that branch' using errcode = '42501';
    end if;
    select b.code into v_code from public.branches b
     where b.id = p_branch_id and b.tenant_id = v_tenant;
    if v_code is null then
      raise exception 'Unknown branch' using errcode = '23503';
    end if;
  elsif p_doc_type in ('purchase_order', 'transfer') then
    p_branch_id := null;
  else
    raise exception 'Unknown document type %', p_doc_type using errcode = '22023';
  end if;

  insert into public.document_sequences (tenant_id, branch_id, doc_type, last_number)
  values (v_tenant, p_branch_id, p_doc_type, 1)
  on conflict (tenant_id, branch_id, doc_type)
  do update set last_number = public.document_sequences.last_number + 1, updated_at = now()
  returning last_number into v_n;

  return case p_doc_type
    when 'receipt'        then v_code || '-' || lpad(v_n::text, 6, '0')
    when 'return'         then 'RT-' || v_code || '-' || lpad(v_n::text, 6, '0')
    when 'purchase_order' then 'PO-' || lpad(v_n::text, 6, '0')
    when 'transfer'       then 'TR-' || lpad(v_n::text, 6, '0')
  end;
end $$;

revoke execute on function public.next_document_number(text, uuid) from public, anon;
grant  execute on function public.next_document_number(text, uuid) to authenticated;
