-- =====================================================================
-- Phase 5b / 17 — Offline sales
-- A sale rung up while the internet was down is sent later with
--   offline = true, its original time, and a receipt number made on the device.
-- The goods have already left the shop, so the server RECORDS such a sale
-- even if it breaks a rule (discount above limit, price below the floor,
-- credit limit...) but FLAGS it for the owner/manager to review.
-- Online sales keep all the strict rules.
-- =====================================================================

alter table public.sales
  add column if not exists is_offline    boolean not null default false,
  add column if not exists offline_flags text[]  not null default '{}',
  add column if not exists reviewed_by   uuid,
  add column if not exists reviewed_at   timestamptz;

create index if not exists sales_needs_review
  on public.sales (tenant_id, sold_at desc)
  where offline_flags <> '{}' and reviewed_at is null;

create or replace function private.sale_summary(p_sale uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('sale_id', s.id, 'receipt_no', s.receipt_no, 'total', s.total,
                            'amount_paid', s.amount_paid, 'balance_due', s.balance_due,
                            'flagged', coalesce(array_length(s.offline_flags, 1), 0) > 0)
    from public.sales s where s.id = p_sale
$$;

-- ---------------------------------------------------------------------
-- complete_sale v2 (same as before, plus the offline rules)
-- ---------------------------------------------------------------------
create or replace function public.complete_sale(p_data jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_tenant   uuid := private.tenant_id();
  v_user     uuid := auth.uid();
  v_role     text := private.tenant_role();
  v_branch   uuid := nullif(p_data ->> 'branch_id', '')::uuid;
  v_customer uuid := nullif(p_data ->> 'customer_id', '')::uuid;
  v_client   uuid := nullif(p_data ->> 'client_uuid', '')::uuid;
  v_tier     public.price_tier := coalesce(nullif(p_data ->> 'price_tier', '')::public.price_tier, 'retail');
  v_notes    text := nullif(btrim(coalesce(p_data ->> 'notes', '')), '');
  v_sold_at  timestamptz := coalesce(nullif(p_data ->> 'sold_at', '')::timestamptz, now());
  v_sale_disc numeric := coalesce(nullif(p_data ->> 'discount_total', '')::numeric, 0);
  v_max_pct  numeric := coalesce(nullif(auth.jwt() ->> 'max_discount_pct', '')::numeric, 0);
  v_offline  boolean := coalesce((p_data ->> 'offline')::boolean, false);
  v_req_receipt text := upper(btrim(coalesce(p_data ->> 'receipt_no', '')));
  v_flags    text[] := '{}';
  v_vat_reg  boolean;
  v_vat_rate numeric;
  v_existing public.sales;
  pr         public.products;
  cu         public.customers;
  e          record;
  v_list numeric; v_charged numeric; v_qty numeric; v_unit numeric;
  v_disc numeric; v_line numeric; v_ltax numeric; v_rate numeric; v_pct numeric;
  v_min numeric; v_cost numeric;
  v_lines jsonb := '[]'::jsonb;
  v_pays  jsonb := '[]'::jsonb;
  v_method text; v_amount numeric; v_ref text; v_pnote text;
  v_subtotal numeric := 0; v_tax numeric := 0; v_total numeric; v_paid numeric := 0; v_due numeric;
  v_balance numeric;
  v_sale uuid; v_session uuid; v_receipt text;
begin
  -- ---- who and where
  if v_tenant is null or v_role not in ('owner','manager','cashier') then
    raise exception 'You are not allowed to make sales' using errcode = '42501';
  end if;
  if not private.tenant_writable() then
    raise exception 'Your subscription is not active' using errcode = '42501';
  end if;
  if v_branch is null or not private.can_access_branch(v_branch) then
    raise exception 'You cannot sell in that branch' using errcode = '42501';
  end if;
  if not exists (select 1 from public.branches b where b.id = v_branch and b.tenant_id = v_tenant) then
    raise exception 'Branch not found' using errcode = '22023';
  end if;

  -- ---- the same sale sent twice is recorded once
  if v_client is not null then
    select * into v_existing from public.sales where tenant_id = v_tenant and client_uuid = v_client;
    if v_existing.id is not null then
      return private.sale_summary(v_existing.id) || jsonb_build_object('duplicate', true);
    end if;
  end if;

  if v_sold_at > now() + interval '5 minutes' then v_sold_at := now(); end if;
  if v_sold_at < now() - interval '30 days' then
    raise exception 'This sale is too old to record' using errcode = '22023';
  end if;
  -- only a sale that really is delayed counts as an offline sale
  v_offline := v_offline and v_sold_at < now() - interval '20 seconds';

  select t.vat_registered, t.vat_rate into v_vat_reg, v_vat_rate from public.tenants t where t.id = v_tenant;

  -- ---- items
  for e in select x from jsonb_array_elements(coalesce(p_data -> 'items', '[]'::jsonb)) as j(x) loop
    pr := null;
    select * into pr from public.products p
     where p.id = (e.x ->> 'product_id')::uuid and p.tenant_id = v_tenant
       and (v_offline or (p.is_active and p.deleted_at is null));
    if pr.id is null then
      raise exception 'A product on the bill is no longer available' using errcode = '22023';
    end if;

    v_qty := (e.x ->> 'qty')::numeric;
    if v_qty is null or v_qty <= 0 then
      raise exception 'Quantity for "%" must be more than zero', pr.name using errcode = '22023';
    end if;

    v_list := case when v_tier = 'wholesale' then coalesce(pr.wholesale_price, pr.selling_price) else pr.selling_price end;
    v_charged := coalesce(nullif(e.x ->> 'unit_price', '')::numeric, v_list);
    if v_charged < 0 then
      raise exception 'Price for "%" cannot be negative', pr.name using errcode = '22023';
    end if;
    v_unit := greatest(v_list, v_charged);
    v_disc := round(v_qty * (v_unit - v_charged), 2);
    v_line := round(v_qty * v_charged, 2);

    v_pct := case when v_unit > 0 then (v_unit - v_charged) / v_unit * 100 else 0 end;
    if v_role <> 'owner' and v_pct > v_max_pct + 0.001 then
      if v_offline then
        v_flags := v_flags || format('Discount of %s percent on %s is above the limit of %s percent', round(v_pct, 1), pr.name, v_max_pct);
      else
        raise exception 'The discount on "%" is % percent but your limit is % percent', pr.name, round(v_pct, 1), v_max_pct
          using errcode = 'P0001';
      end if;
    end if;

    v_min := null; v_cost := 0;
    select pc.min_selling_price, pc.cost_price into v_min, v_cost from public.product_costs pc where pc.product_id = pr.id;
    if v_role <> 'owner' and v_min is not null and v_charged < v_min then
      if v_offline then
        v_flags := v_flags || format('%s was sold below the lowest allowed price', pr.name);
      else
        raise exception 'The price of "%" is below the lowest allowed price. Ask the owner.', pr.name using errcode = 'P0001';
      end if;
    end if;

    v_rate := case when v_vat_reg and pr.tax_category = 'standard' then coalesce(v_vat_rate, 16) else 0 end;
    v_ltax := round(v_line - v_line / (1 + v_rate / 100), 2);

    v_subtotal := v_subtotal + v_line;
    v_tax := v_tax + v_ltax;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'product_id', pr.id, 'name', pr.name, 'sku', pr.sku, 'qty', v_qty, 'unit_price', v_unit,
      'cost', coalesce(v_cost, 0), 'discount', v_disc, 'tax_category', pr.tax_category::text,
      'tax_rate', v_rate, 'tax', v_ltax, 'line_total', v_line, 'track', pr.track_stock));
  end loop;

  if jsonb_array_length(v_lines) = 0 then
    raise exception 'Add at least one item to the sale' using errcode = '22023';
  end if;

  -- ---- bill discount and total
  if v_sale_disc < 0 or v_sale_disc > v_subtotal then
    raise exception 'The bill discount is not valid' using errcode = '22023';
  end if;
  if v_role <> 'owner' and v_subtotal > 0 and v_sale_disc / v_subtotal * 100 > v_max_pct + 0.001 then
    if v_offline then
      v_flags := v_flags || format('Bill discount is above the limit of %s percent', v_max_pct);
    else
      raise exception 'The bill discount is above your limit of % percent', v_max_pct using errcode = 'P0001';
    end if;
  end if;
  v_total := round(v_subtotal - v_sale_disc, 2);
  if v_subtotal > 0 then v_tax := round(v_tax * v_total / v_subtotal, 2); end if;

  -- ---- customer
  if v_customer is not null then
    select * into cu from public.customers c where c.id = v_customer and c.tenant_id = v_tenant;
    if cu.id is null or (not v_offline and (not cu.is_active or cu.deleted_at is not null)) then
      raise exception 'Customer not found' using errcode = '22023';
    end if;
  end if;

  -- ---- payments
  for e in select x from jsonb_array_elements(coalesce(p_data -> 'payments', '[]'::jsonb)) as j(x) loop
    v_method := lower(coalesce(e.x ->> 'method', ''));
    v_amount := round(coalesce(nullif(e.x ->> 'amount', '')::numeric, 0), 2);
    v_ref := nullif(upper(btrim(coalesce(e.x ->> 'reference', ''))), '');
    v_pnote := null;
    if v_method not in ('cash','mpesa','bank','other') then
      raise exception 'Unknown payment method' using errcode = '22023';
    end if;
    if v_amount <= 0 then
      raise exception 'Payment amounts must be more than zero' using errcode = '22023';
    end if;
    if v_method = 'mpesa' then
      if v_ref is null or v_ref !~ '^[A-Z0-9]{8,12}$' then
        if v_offline then
          v_flags := v_flags || ('M-Pesa code missing or invalid: ' || coalesce(v_ref, '(none)'));
          v_pnote := 'M-Pesa code missing or invalid (' || coalesce(v_ref, 'none') || ')';
          v_ref := null;
        else
          raise exception 'Enter the M-Pesa transaction code (8 to 12 letters and numbers)' using errcode = '22023';
        end if;
      elsif exists (select 1 from public.payments pm where pm.tenant_id = v_tenant and pm.method = 'mpesa' and pm.reference = v_ref) then
        if v_offline then
          v_flags := v_flags || ('M-Pesa code ' || v_ref || ' was already used on another sale');
          v_pnote := 'Duplicate M-Pesa code ' || v_ref;
          v_ref := null;
        else
          raise exception 'M-Pesa code % was already used on another sale', v_ref using errcode = '23505';
        end if;
      end if;
    end if;
    v_paid := v_paid + v_amount;
    v_pays := v_pays || jsonb_build_array(jsonb_build_object('method', v_method, 'amount', v_amount, 'reference', v_ref, 'note', v_pnote));
  end loop;

  if v_paid > v_total + 0.001 then
    raise exception 'The payments are more than the total' using errcode = '22023';
  end if;
  v_due := round(v_total - v_paid, 2);

  -- ---- unpaid part goes on credit
  if v_due > 0.009 then
    if v_customer is null then
      if v_offline then
        v_flags := v_flags || 'Not fully paid and no customer was chosen';
      else
        raise exception 'The bill is not fully paid. Choose a customer to put the balance on credit.' using errcode = '22023';
      end if;
    elsif cu.credit_limit <= 0 then
      if v_offline then
        v_flags := v_flags || (cu.name || ' has no credit allowed but took goods on credit');
      else
        raise exception '% has no credit allowed. Ask the owner or a manager.', cu.name using errcode = 'P0001';
      end if;
    else
      select coalesce(sum(l.amount), 0) into v_balance
        from public.customer_ledger l where l.tenant_id = v_tenant and l.customer_id = v_customer;
      if v_balance + v_due > cu.credit_limit then
        if v_offline then
          v_flags := v_flags || format('%s is over the credit limit (owes %s, limit %s, this sale adds %s)', cu.name, v_balance, cu.credit_limit, v_due);
        else
          raise exception 'Credit limit exceeded: % owes %, the limit is % and this sale adds %',
            cu.name, v_balance, cu.credit_limit, v_due using errcode = 'P0001';
        end if;
      end if;
    end if;
  end if;

  -- ---- till
  select cs.id into v_session from public.cash_sessions cs
   where cs.tenant_id = v_tenant and cs.branch_id = v_branch and cs.opened_by = v_user and cs.status = 'open';
  if v_session is null then
    insert into public.cash_sessions (tenant_id, branch_id, opened_by, opening_float)
    values (v_tenant, v_branch, v_user, 0) returning id into v_session;
  end if;

  -- ---- receipt number: an offline sale keeps the number printed on the device
  if v_offline and v_req_receipt ~ '^[A-Z0-9]{2,6}-D[A-Z0-9]{4}-[0-9]{1,6}$'
     and not exists (select 1 from public.sales s where s.tenant_id = v_tenant and s.branch_id = v_branch and s.receipt_no = v_req_receipt) then
    v_receipt := v_req_receipt;
  else
    v_receipt := public.next_document_number('receipt', v_branch);
  end if;

  insert into public.sales
    (tenant_id, branch_id, receipt_no, customer_id, cashier_id, cash_session_id, status, price_tier,
     subtotal, discount_total, tax_total, total, amount_paid, notes, sold_at, client_uuid, is_offline, offline_flags)
  values
    (v_tenant, v_branch, v_receipt, v_customer, v_user, v_session, 'completed', v_tier,
     v_subtotal, v_sale_disc, v_tax, v_total, 0, v_notes, v_sold_at, v_client, v_offline, v_flags)
  returning id into v_sale;

  for e in select x from jsonb_array_elements(v_lines) as j(x) loop
    insert into public.sale_items
      (tenant_id, sale_id, product_id, product_name, sku, quantity, unit_price, unit_cost,
       discount_amount, tax_category, tax_rate, tax_amount, line_total)
    values
      (v_tenant, v_sale, (e.x ->> 'product_id')::uuid, e.x ->> 'name', e.x ->> 'sku',
       (e.x ->> 'qty')::numeric, (e.x ->> 'unit_price')::numeric, (e.x ->> 'cost')::numeric,
       (e.x ->> 'discount')::numeric, (e.x ->> 'tax_category')::public.tax_category,
       (e.x ->> 'tax_rate')::numeric, (e.x ->> 'tax')::numeric, (e.x ->> 'line_total')::numeric);

    if (e.x ->> 'track')::boolean then
      insert into public.stock_movements
        (tenant_id, branch_id, product_id, movement_type, quantity, unit_cost, reference_type, reference_id, created_by)
      values
        (v_tenant, v_branch, (e.x ->> 'product_id')::uuid, 'sale', -((e.x ->> 'qty')::numeric),
         (e.x ->> 'cost')::numeric, 'sale', v_sale, v_user);
    end if;
  end loop;

  for e in select x from jsonb_array_elements(v_pays) as j(x) loop
    insert into public.payments
      (tenant_id, branch_id, kind, sale_id, customer_id, method, amount, reference,
       cash_session_id, received_by, paid_at, note)
    values
      (v_tenant, v_branch, 'sale_payment', v_sale, v_customer, (e.x ->> 'method')::public.payment_method,
       (e.x ->> 'amount')::numeric, e.x ->> 'reference', v_session, v_user, v_sold_at,
       coalesce(e.x ->> 'note',
                case when e.x ->> 'method' = 'mpesa' then 'M-Pesa code entered by staff (not yet verified)' end));
  end loop;

  return private.sale_summary(v_sale);
end $$;

-- ---------------------------------------------------------------------
-- Owner / manager marks a flagged sale as checked
-- ---------------------------------------------------------------------
create or replace function public.mark_sale_reviewed(p_sale_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare v_tenant uuid := private.tenant_id(); s public.sales;
begin
  if v_tenant is null or not private.has_role(array['owner','manager']) then
    raise exception 'Only the owner or a manager can review sales' using errcode = '42501';
  end if;
  select * into s from public.sales where id = p_sale_id and tenant_id = v_tenant for update;
  if s.id is null then
    raise exception 'Sale not found' using errcode = 'P0002';
  end if;
  if not private.can_access_branch(s.branch_id) then
    raise exception 'You cannot review sales of that branch' using errcode = '42501';
  end if;
  update public.sales set reviewed_by = auth.uid(), reviewed_at = now() where id = s.id;
end $$;

revoke execute on function public.mark_sale_reviewed(uuid) from public, anon;
grant execute on function public.mark_sale_reviewed(uuid) to authenticated;
