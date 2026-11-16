-- =====================================================================
-- Phase 5a / 16 — Point of sale
--   complete_sale()     : the ONE safe way to record a sale
--   void_sale()         : owner/manager cancels a sale and restocks
--   return_items()      : owner/manager takes items back and refunds
--   open/close till     : cash sessions with expected-vs-counted cash-up
--   sales_summary()     : numbers for the dashboard
-- Sales, payments, returns, ledgers and tills can no longer be written
-- directly by the app: only through these functions, which enforce
-- prices, discount limits, credit limits and stock.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Lock direct writes (reads stay as before)
-- ---------------------------------------------------------------------
revoke insert, update, delete on
  public.sales, public.sale_items, public.payments,
  public.sale_returns, public.sale_return_items,
  public.customer_ledger, public.cash_sessions
from authenticated;

-- one M-Pesa code can only ever be used once
create unique index if not exists payments_mpesa_reference_unique
  on public.payments (tenant_id, reference)
  where method = 'mpesa' and reference is not null;

-- cashiers may add customers but never give anyone credit
create or replace function private.guard_customer_credit()
returns trigger language plpgsql as $$
begin
  if private.tenant_role() = 'cashier' then
    if tg_op = 'INSERT' and new.credit_limit <> 0 then
      raise exception 'Only the owner or a manager can set a credit limit' using errcode = '42501';
    elsif tg_op = 'UPDATE' and new.credit_limit is distinct from old.credit_limit then
      raise exception 'Only the owner or a manager can change a credit limit' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_guard_customer_credit on public.customers;
create trigger trg_guard_customer_credit before insert or update on public.customers
  for each row execute function private.guard_customer_credit();

-- ---------------------------------------------------------------------
-- 2. Helpers
-- ---------------------------------------------------------------------
create or replace function private.sale_summary(p_sale uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('sale_id', s.id, 'receipt_no', s.receipt_no, 'total', s.total,
                            'amount_paid', s.amount_paid, 'balance_due', s.balance_due)
    from public.sales s where s.id = p_sale
$$;

-- ---------------------------------------------------------------------
-- 3. complete_sale
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
  v_method text; v_amount numeric; v_ref text;
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
  if not exists (select 1 from public.branches b where b.id = v_branch and b.tenant_id = v_tenant and b.is_active) then
    raise exception 'Branch not found' using errcode = '22023';
  end if;

  -- ---- the same sale sent twice (bad network, double tap) is recorded once
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

  select t.vat_registered, t.vat_rate into v_vat_reg, v_vat_rate from public.tenants t where t.id = v_tenant;

  -- ---- items: price, discount limit, price floor, VAT
  for e in select x from jsonb_array_elements(coalesce(p_data -> 'items', '[]'::jsonb)) as j(x) loop
    pr := null;
    select * into pr from public.products p
     where p.id = (e.x ->> 'product_id')::uuid and p.tenant_id = v_tenant and p.is_active and p.deleted_at is null;
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
      raise exception 'The discount on "%" is % percent but your limit is % percent', pr.name, round(v_pct, 1), v_max_pct
        using errcode = 'P0001';
    end if;

    v_min := null; v_cost := 0;
    select pc.min_selling_price, pc.cost_price into v_min, v_cost from public.product_costs pc where pc.product_id = pr.id;
    if v_role <> 'owner' and v_min is not null and v_charged < v_min then
      raise exception 'The price of "%" is below the lowest allowed price. Ask the owner.', pr.name using errcode = 'P0001';
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

  -- ---- bill-level discount and total
  if v_sale_disc < 0 or v_sale_disc > v_subtotal then
    raise exception 'The bill discount is not valid' using errcode = '22023';
  end if;
  if v_role <> 'owner' and v_subtotal > 0 and v_sale_disc / v_subtotal * 100 > v_max_pct + 0.001 then
    raise exception 'The bill discount is above your limit of % percent', v_max_pct using errcode = 'P0001';
  end if;
  v_total := round(v_subtotal - v_sale_disc, 2);
  if v_subtotal > 0 then v_tax := round(v_tax * v_total / v_subtotal, 2); end if;

  -- ---- customer
  if v_customer is not null then
    select * into cu from public.customers c
     where c.id = v_customer and c.tenant_id = v_tenant and c.is_active and c.deleted_at is null;
    if cu.id is null then
      raise exception 'Customer not found' using errcode = '22023';
    end if;
  end if;

  -- ---- payments
  for e in select x from jsonb_array_elements(coalesce(p_data -> 'payments', '[]'::jsonb)) as j(x) loop
    v_method := lower(coalesce(e.x ->> 'method', ''));
    v_amount := round(coalesce(nullif(e.x ->> 'amount', '')::numeric, 0), 2);
    v_ref := nullif(upper(btrim(coalesce(e.x ->> 'reference', ''))), '');
    if v_method not in ('cash','mpesa','bank','other') then
      raise exception 'Unknown payment method' using errcode = '22023';
    end if;
    if v_amount <= 0 then
      raise exception 'Payment amounts must be more than zero' using errcode = '22023';
    end if;
    if v_method = 'mpesa' then
      if v_ref is null or v_ref !~ '^[A-Z0-9]{8,12}$' then
        raise exception 'Enter the M-Pesa transaction code (8 to 12 letters and numbers)' using errcode = '22023';
      end if;
      if exists (select 1 from public.payments pm where pm.tenant_id = v_tenant and pm.method = 'mpesa' and pm.reference = v_ref) then
        raise exception 'M-Pesa code % was already used on another sale', v_ref using errcode = '23505';
      end if;
    end if;
    v_paid := v_paid + v_amount;
    v_pays := v_pays || jsonb_build_array(jsonb_build_object('method', v_method, 'amount', v_amount, 'reference', v_ref));
  end loop;

  if v_paid > v_total + 0.001 then
    raise exception 'The payments are more than the total' using errcode = '22023';
  end if;
  v_due := round(v_total - v_paid, 2);

  -- ---- unpaid part goes on credit
  if v_due > 0.009 then
    if v_customer is null then
      raise exception 'The bill is not fully paid. Choose a customer to put the balance on credit.' using errcode = '22023';
    end if;
    if cu.credit_limit <= 0 then
      raise exception '% has no credit allowed. Ask the owner or a manager.', cu.name using errcode = 'P0001';
    end if;
    select coalesce(sum(l.amount), 0) into v_balance
      from public.customer_ledger l where l.tenant_id = v_tenant and l.customer_id = v_customer;
    if v_balance + v_due > cu.credit_limit then
      raise exception 'Credit limit exceeded: % owes %, the limit is % and this sale adds %',
        cu.name, v_balance, cu.credit_limit, v_due using errcode = 'P0001';
    end if;
  end if;

  -- ---- till: use the cashier's open till, or open one automatically
  select cs.id into v_session from public.cash_sessions cs
   where cs.tenant_id = v_tenant and cs.branch_id = v_branch and cs.opened_by = v_user and cs.status = 'open';
  if v_session is null then
    insert into public.cash_sessions (tenant_id, branch_id, opened_by, opening_float)
    values (v_tenant, v_branch, v_user, 0) returning id into v_session;
  end if;

  v_receipt := public.next_document_number('receipt', v_branch);

  insert into public.sales
    (tenant_id, branch_id, receipt_no, customer_id, cashier_id, cash_session_id, status, price_tier,
     subtotal, discount_total, tax_total, total, amount_paid, notes, sold_at, client_uuid)
  values
    (v_tenant, v_branch, v_receipt, v_customer, v_user, v_session, 'completed', v_tier,
     v_subtotal, v_sale_disc, v_tax, v_total, 0, v_notes, v_sold_at, v_client)
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
       case when e.x ->> 'method' = 'mpesa' then 'M-Pesa code entered by staff (not yet verified)' end);
  end loop;

  return private.sale_summary(v_sale);
end $$;

-- ---------------------------------------------------------------------
-- 4. void_sale (owner / manager)
-- ---------------------------------------------------------------------
create or replace function public.void_sale(p_sale_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_tenant uuid := private.tenant_id();
  s public.sales;
  it record;
begin
  if v_tenant is null or not private.has_role(array['owner','manager']) then
    raise exception 'Only the owner or a manager can cancel a sale' using errcode = '42501';
  end if;
  if not private.tenant_writable() then
    raise exception 'Your subscription is not active' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Please give a reason for cancelling the sale' using errcode = '22023';
  end if;

  select * into s from public.sales where id = p_sale_id and tenant_id = v_tenant for update;
  if s.id is null then
    raise exception 'Sale not found' using errcode = 'P0002';
  end if;
  if not private.can_access_branch(s.branch_id) then
    raise exception 'You cannot change sales of that branch' using errcode = '42501';
  end if;
  if s.status <> 'completed' then
    raise exception 'Only a completed sale can be cancelled (this one is %)', s.status;
  end if;
  if exists (select 1 from public.sale_returns r where r.sale_id = s.id) then
    raise exception 'This sale already has returns, so it cannot be cancelled';
  end if;

  for it in
    select si.product_id, si.quantity, si.unit_cost
      from public.sale_items si join public.products p on p.id = si.product_id
     where si.sale_id = s.id and p.track_stock
  loop
    insert into public.stock_movements
      (tenant_id, branch_id, product_id, movement_type, quantity, unit_cost, reference_type, reference_id, reason, created_by)
    values
      (v_tenant, s.branch_id, it.product_id, 'sale_return', it.quantity, it.unit_cost, 'sale', s.id,
       'Sale ' || s.receipt_no || ' cancelled', auth.uid());
  end loop;

  update public.sales
     set status = 'voided', voided_by = auth.uid(), voided_at = now(), void_reason = btrim(p_reason)
   where id = s.id;
end $$;

-- ---------------------------------------------------------------------
-- 5. return_items (owner / manager)
--    p_items: [{sale_item_id, qty, restock}]   restock=false for damaged goods
-- ---------------------------------------------------------------------
create or replace function public.return_items(
  p_sale_id       uuid,
  p_items         jsonb,
  p_refund_method public.refund_method,
  p_reason        text
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_tenant uuid := private.tenant_id();
  s   public.sales;
  si  public.sale_items;
  e   record;
  v_factor numeric;
  v_q numeric; v_refund numeric; v_total numeric := 0;
  v_prep jsonb := '[]'::jsonb;
  v_ret uuid; v_no text; v_all boolean; v_track boolean;
begin
  if v_tenant is null or not private.has_role(array['owner','manager']) then
    raise exception 'Only the owner or a manager can take items back' using errcode = '42501';
  end if;
  if not private.tenant_writable() then
    raise exception 'Your subscription is not active' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Please give a reason for the return' using errcode = '22023';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Choose the items being returned' using errcode = '22023';
  end if;

  select * into s from public.sales where id = p_sale_id and tenant_id = v_tenant for update;
  if s.id is null then
    raise exception 'Sale not found' using errcode = 'P0002';
  end if;
  if not private.can_access_branch(s.branch_id) then
    raise exception 'You cannot change sales of that branch' using errcode = '42501';
  end if;
  if s.status not in ('completed','partially_returned') then
    raise exception 'This sale cannot be returned (it is %)', s.status;
  end if;
  if p_refund_method = 'debt_credit' and s.customer_id is null then
    raise exception 'This sale has no customer, so choose cash, M-Pesa or bank for the refund' using errcode = '22023';
  end if;

  v_factor := case when s.subtotal > 0 then s.total / s.subtotal else 1 end;

  -- check everything first
  for e in select x from jsonb_array_elements(p_items) as j(x) loop
    select * into si from public.sale_items
     where id = (e.x ->> 'sale_item_id')::uuid and sale_id = s.id and tenant_id = v_tenant for update;
    if si.id is null then
      raise exception 'An item was not found on this sale' using errcode = '22023';
    end if;
    v_q := (e.x ->> 'qty')::numeric;
    if v_q is null or v_q <= 0 or v_q > si.quantity - si.returned_qty then
      raise exception 'You can return at most % of "%"', si.quantity - si.returned_qty, si.product_name using errcode = '22023';
    end if;
    v_refund := round(v_q * (si.line_total / si.quantity) * v_factor, 2);
    v_total := v_total + v_refund;
    v_prep := v_prep || jsonb_build_array(jsonb_build_object(
      'item_id', si.id, 'product_id', si.product_id, 'qty', v_q, 'refund', v_refund,
      'unit', round(si.line_total / si.quantity * v_factor, 2), 'cost', si.unit_cost,
      'restock', coalesce((e.x ->> 'restock')::boolean, true)));
  end loop;

  v_no := public.next_document_number('return', s.branch_id);
  insert into public.sale_returns (tenant_id, branch_id, sale_id, return_no, reason, refund_method, total_refund, processed_by)
  values (v_tenant, s.branch_id, s.id, v_no, btrim(p_reason), p_refund_method, v_total, auth.uid())
  returning id into v_ret;

  for e in select x from jsonb_array_elements(v_prep) as j(x) loop
    insert into public.sale_return_items (tenant_id, return_id, sale_item_id, product_id, quantity, unit_price, line_total, restock)
    values (v_tenant, v_ret, (e.x ->> 'item_id')::uuid, (e.x ->> 'product_id')::uuid, (e.x ->> 'qty')::numeric,
            (e.x ->> 'unit')::numeric, (e.x ->> 'refund')::numeric, (e.x ->> 'restock')::boolean);

    update public.sale_items set returned_qty = returned_qty + (e.x ->> 'qty')::numeric
     where id = (e.x ->> 'item_id')::uuid;

    select p.track_stock into v_track from public.products p where p.id = (e.x ->> 'product_id')::uuid;
    if (e.x ->> 'restock')::boolean and v_track then
      insert into public.stock_movements
        (tenant_id, branch_id, product_id, movement_type, quantity, unit_cost, reference_type, reference_id, reason, created_by)
      values
        (v_tenant, s.branch_id, (e.x ->> 'product_id')::uuid, 'sale_return', (e.x ->> 'qty')::numeric,
         (e.x ->> 'cost')::numeric, 'sale_return', v_ret, 'Return ' || v_no, auth.uid());
    end if;
  end loop;

  select not exists (select 1 from public.sale_items i where i.sale_id = s.id and i.returned_qty < i.quantity) into v_all;
  update public.sales set status = case when v_all then 'returned' else 'partially_returned' end where id = s.id;

  -- customer account: the returned value reduces what they owe; money paid out is added back
  if s.customer_id is not null and v_total > 0 then
    insert into public.customer_ledger (tenant_id, customer_id, branch_id, entry_type, amount, sale_id, note, created_by)
    values (v_tenant, s.customer_id, s.branch_id, 'return', -v_total, s.id, 'Return ' || v_no, auth.uid());
    if p_refund_method in ('cash','mpesa','bank') then
      insert into public.customer_ledger (tenant_id, customer_id, branch_id, entry_type, amount, sale_id, note, created_by)
      values (v_tenant, s.customer_id, s.branch_id, 'adjustment', v_total, s.id, 'Refund paid out for ' || v_no, auth.uid());
    end if;
  end if;

  return jsonb_build_object('return_id', v_ret, 'return_no', v_no, 'refund', v_total);
end $$;

-- ---------------------------------------------------------------------
-- 6. Tills (cash sessions)
-- ---------------------------------------------------------------------
create or replace function public.open_cash_session(p_branch_id uuid, p_float numeric default 0)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_tenant uuid := private.tenant_id(); v_id uuid;
begin
  if v_tenant is null or not private.has_role(array['owner','manager','cashier']) then
    raise exception 'You are not allowed to open a till' using errcode = '42501';
  end if;
  if not private.tenant_writable() then
    raise exception 'Your subscription is not active' using errcode = '42501';
  end if;
  if p_branch_id is null or not private.can_access_branch(p_branch_id) then
    raise exception 'You cannot work in that branch' using errcode = '42501';
  end if;
  if coalesce(p_float, 0) < 0 then
    raise exception 'The opening cash cannot be negative' using errcode = '22023';
  end if;
  if exists (select 1 from public.cash_sessions cs where cs.tenant_id = v_tenant and cs.branch_id = p_branch_id
              and cs.opened_by = auth.uid() and cs.status = 'open') then
    raise exception 'You already have an open till in this branch';
  end if;
  insert into public.cash_sessions (tenant_id, branch_id, opened_by, opening_float)
  values (v_tenant, p_branch_id, auth.uid(), coalesce(p_float, 0)) returning id into v_id;
  return v_id;
end $$;

create or replace function public.session_totals(p_session_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_tenant uuid := private.tenant_id();
  s public.cash_sessions;
  v_cash numeric; v_mpesa numeric; v_bank numeric; v_other numeric;
  v_refunds numeric; v_expenses numeric; v_count int; v_sales numeric;
begin
  select * into s from public.cash_sessions where id = p_session_id and tenant_id = v_tenant;
  if s.id is null then
    raise exception 'Till not found' using errcode = 'P0002';
  end if;
  if not (private.can_access_branch(s.branch_id) and
          (private.has_role(array['owner','manager']) or s.opened_by = auth.uid())) then
    raise exception 'You cannot see this till' using errcode = '42501';
  end if;

  select coalesce(sum(p.amount) filter (where p.method = 'cash'), 0),
         coalesce(sum(p.amount) filter (where p.method = 'mpesa'), 0),
         coalesce(sum(p.amount) filter (where p.method = 'bank'), 0),
         coalesce(sum(p.amount) filter (where p.method = 'other'), 0)
    into v_cash, v_mpesa, v_bank, v_other
    from public.payments p
    left join public.sales sa on sa.id = p.sale_id and sa.tenant_id = p.tenant_id
   where p.cash_session_id = s.id and (sa.id is null or sa.status <> 'voided');

  select coalesce(sum(r.total_refund), 0) into v_refunds
    from public.sale_returns r
   where r.tenant_id = v_tenant and r.branch_id = s.branch_id and r.refund_method = 'cash'
     and r.created_at >= s.opened_at and (s.closed_at is null or r.created_at <= s.closed_at);

  select coalesce(sum(x.amount), 0) into v_expenses
    from public.expenses x where x.cash_session_id = s.id and x.method = 'cash';

  select count(*), coalesce(sum(sa.total), 0) into v_count, v_sales
    from public.sales sa where sa.cash_session_id = s.id and sa.status <> 'voided';

  return jsonb_build_object(
    'session_id', s.id, 'status', s.status, 'opened_at', s.opened_at, 'closed_at', s.closed_at,
    'opening_float', s.opening_float,
    'cash_in', v_cash, 'mpesa_in', v_mpesa, 'bank_in', v_bank, 'other_in', v_other,
    'cash_refunds', v_refunds, 'cash_expenses', v_expenses,
    'expected_cash', s.opening_float + v_cash - v_refunds - v_expenses,
    'sales_count', v_count, 'sales_total', v_sales,
    'counted_cash', s.counted_cash, 'cash_variance', s.cash_variance);
end $$;

create or replace function public.close_cash_session(p_session_id uuid, p_counted numeric, p_notes text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_tenant uuid := private.tenant_id();
  s public.cash_sessions;
  t jsonb;
begin
  if v_tenant is null or not private.has_role(array['owner','manager','cashier']) then
    raise exception 'You are not allowed to close a till' using errcode = '42501';
  end if;
  if p_counted is null or p_counted < 0 then
    raise exception 'Enter the cash you counted' using errcode = '22023';
  end if;

  select * into s from public.cash_sessions where id = p_session_id and tenant_id = v_tenant for update;
  if s.id is null then
    raise exception 'Till not found' using errcode = 'P0002';
  end if;
  if s.status <> 'open' then
    raise exception 'This till is already closed';
  end if;

  t := public.session_totals(p_session_id);   -- also checks access

  update public.cash_sessions
     set status = 'closed', closed_by = auth.uid(), closed_at = now(),
         expected_cash = (t ->> 'expected_cash')::numeric,
         counted_cash = p_counted,
         cash_variance = p_counted - (t ->> 'expected_cash')::numeric,
         expected_mpesa = (t ->> 'mpesa_in')::numeric,
         expected_bank = (t ->> 'bank_in')::numeric,
         notes = nullif(btrim(coalesce(p_notes, '')), '')
   where id = s.id;

  return public.session_totals(p_session_id);
end $$;

-- ---------------------------------------------------------------------
-- 7. Dashboard numbers (runs with the caller's permissions)
-- ---------------------------------------------------------------------
create or replace function public.sales_summary(p_from timestamptz, p_to timestamptz)
returns jsonb
language sql stable set search_path = ''
as $$
  select jsonb_build_object(
    'count',  count(*)                          filter (where status <> 'voided' and status <> 'held'),
    'total',  coalesce(sum(total)               filter (where status <> 'voided' and status <> 'held'), 0),
    'credit', coalesce(sum(total - amount_paid) filter (where status <> 'voided' and status <> 'held'), 0))
  from public.sales
  where sold_at >= p_from and sold_at < p_to
$$;

-- ---------------------------------------------------------------------
-- 8. Who may call what
-- ---------------------------------------------------------------------
revoke execute on function public.complete_sale(jsonb) from public, anon;
revoke execute on function public.void_sale(uuid, text) from public, anon;
revoke execute on function public.return_items(uuid, jsonb, public.refund_method, text) from public, anon;
revoke execute on function public.open_cash_session(uuid, numeric) from public, anon;
revoke execute on function public.session_totals(uuid) from public, anon;
revoke execute on function public.close_cash_session(uuid, numeric, text) from public, anon;
revoke execute on function public.sales_summary(timestamptz, timestamptz) from public, anon;
grant execute on function public.complete_sale(jsonb) to authenticated;
grant execute on function public.void_sale(uuid, text) to authenticated;
grant execute on function public.return_items(uuid, jsonb, public.refund_method, text) to authenticated;
grant execute on function public.open_cash_session(uuid, numeric) to authenticated;
grant execute on function public.session_totals(uuid) to authenticated;
grant execute on function public.close_cash_session(uuid, numeric, text) to authenticated;
grant execute on function public.sales_summary(timestamptz, timestamptz) to authenticated;
