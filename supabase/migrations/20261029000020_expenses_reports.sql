-- =====================================================================
-- Phase 7 / 20 — Expenses, till that includes them, and reports
--   record_expense() / delete_expense()
--   pay_supplier(): optional "paid from the till"
--   session_totals(): cash out for expenses AND supplier payments
--   report_profit, report_daily, report_top_products, report_slow_stock,
--   report_stock_value, report_staff   (owner / manager only)
-- Reports use Kenya time (Africa/Nairobi) for "today", "this month"...
-- =====================================================================

alter table public.supplier_payments add column if not exists cash_session_id uuid;

-- expenses are written only through record_expense / delete_expense
revoke insert, update, delete on public.expenses from authenticated;

-- ---------------------------------------------------------------------
-- Record an expense
--   p_data: {branch_id, category_id?, amount, method, paid_to, description, reference, incurred_on?}
-- A cash expense is taken from the person's till (opened automatically if needed).
-- ---------------------------------------------------------------------
create or replace function public.record_expense(p_data jsonb)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_tenant uuid := private.tenant_id();
  v_user   uuid := auth.uid();
  v_role   text := private.tenant_role();
  v_branch uuid := nullif(p_data ->> 'branch_id', '')::uuid;
  v_cat    uuid := nullif(p_data ->> 'category_id', '')::uuid;
  v_amount numeric := round(coalesce(nullif(p_data ->> 'amount', '')::numeric, 0), 2);
  v_method text := lower(coalesce(nullif(p_data ->> 'method', ''), 'cash'));
  v_paid_to text := nullif(btrim(coalesce(p_data ->> 'paid_to', '')), '');
  v_desc   text := nullif(btrim(coalesce(p_data ->> 'description', '')), '');
  v_ref    text := nullif(btrim(coalesce(p_data ->> 'reference', '')), '');
  v_today  date := (now() at time zone 'Africa/Nairobi')::date;
  v_date   date := coalesce(nullif(p_data ->> 'incurred_on', '')::date, (now() at time zone 'Africa/Nairobi')::date);
  v_session uuid;
  v_id uuid;
begin
  if v_tenant is null or v_role not in ('owner','manager','cashier') then
    raise exception 'You are not allowed to record expenses' using errcode = '42501';
  end if;
  if not private.tenant_writable() then
    raise exception 'Your subscription is not active' using errcode = '42501';
  end if;
  if v_branch is null or not private.can_access_branch(v_branch)
     or not exists (select 1 from public.branches b where b.id = v_branch and b.tenant_id = v_tenant) then
    raise exception 'Choose the branch' using errcode = '22023';
  end if;
  if v_amount <= 0 then
    raise exception 'Enter an amount more than zero' using errcode = '22023';
  end if;
  if v_method not in ('cash','mpesa','bank','other') then
    raise exception 'Choose how it was paid' using errcode = '22023';
  end if;
  if v_cat is not null and not exists (select 1 from public.expense_categories c where c.id = v_cat and c.tenant_id = v_tenant) then
    raise exception 'Category not found' using errcode = '22023';
  end if;
  if v_cat is null and v_desc is null then
    raise exception 'Say what the money was for (choose a category or write a description)' using errcode = '22023';
  end if;
  if v_date > v_today then
    raise exception 'The date cannot be in the future' using errcode = '22023';
  end if;
  if v_date < v_today - 365 then
    raise exception 'That date is too old' using errcode = '22023';
  end if;
  if v_role = 'cashier' and v_date <> v_today then
    raise exception 'Cashiers can only record today''s expenses' using errcode = '42501';
  end if;

  if v_method = 'cash' then
    select cs.id into v_session from public.cash_sessions cs
     where cs.tenant_id = v_tenant and cs.branch_id = v_branch and cs.opened_by = v_user and cs.status = 'open';
    if v_session is null then
      insert into public.cash_sessions (tenant_id, branch_id, opened_by, opening_float)
      values (v_tenant, v_branch, v_user, 0) returning id into v_session;
    end if;
  end if;

  insert into public.expenses
    (tenant_id, branch_id, category_id, amount, method, reference, paid_to, description, incurred_on, cash_session_id, created_by)
  values
    (v_tenant, v_branch, v_cat, v_amount, v_method::public.payment_method, v_ref, v_paid_to, v_desc, v_date, v_session, v_user)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.delete_expense(p_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare v_tenant uuid := private.tenant_id(); e public.expenses;
begin
  if v_tenant is null or not private.has_role(array['owner','manager']) then
    raise exception 'Only the owner or a manager can delete an expense' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Please give a reason' using errcode = '22023';
  end if;
  select * into e from public.expenses x where x.id = p_id and x.tenant_id = v_tenant for update;
  if e.id is null then
    raise exception 'Expense not found' using errcode = 'P0002';
  end if;
  if not private.can_access_branch(e.branch_id) then
    raise exception 'You cannot change expenses of that branch' using errcode = '42501';
  end if;
  insert into public.audit_logs (tenant_id, user_id, action, table_name, record_id, old_data, new_data)
  values (v_tenant, auth.uid(), 'expense_deleted', 'expenses', e.id::text, to_jsonb(e), jsonb_build_object('reason', btrim(p_reason)));
  delete from public.expenses where id = e.id;
end $$;

-- ---------------------------------------------------------------------
-- pay_supplier v2: "from_till" takes cash out of the drawer
-- ---------------------------------------------------------------------
create or replace function public.pay_supplier(p_data jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_tenant   uuid := private.tenant_id();
  v_supplier uuid := nullif(p_data ->> 'supplier_id', '')::uuid;
  v_branch   uuid := nullif(p_data ->> 'branch_id', '')::uuid;
  v_client   uuid := nullif(p_data ->> 'client_uuid', '')::uuid;
  v_amount   numeric := round(coalesce(nullif(p_data ->> 'amount', '')::numeric, 0), 2);
  v_method   text := lower(coalesce(p_data ->> 'method', ''));
  v_ref      text := nullif(btrim(coalesce(p_data ->> 'reference', '')), '');
  v_note     text := nullif(btrim(coalesce(p_data ->> 'note', '')), '');
  v_from_till boolean := coalesce((p_data ->> 'from_till')::boolean, false);
  v_name text; v_pay uuid; v_balance numeric; v_session uuid;
begin
  if v_tenant is null or not private.has_role(array['owner','manager']) then
    raise exception 'Only the owner or a manager can pay suppliers' using errcode = '42501';
  end if;
  if not private.tenant_writable() then
    raise exception 'Your subscription is not active' using errcode = '42501';
  end if;
  if v_method not in ('cash','mpesa','bank','other') then
    raise exception 'Choose how you paid' using errcode = '22023';
  end if;
  if v_amount <= 0 then
    raise exception 'Enter an amount more than zero' using errcode = '22023';
  end if;
  if v_branch is not null and not private.can_access_branch(v_branch) then
    raise exception 'You cannot record payments for that branch' using errcode = '42501';
  end if;
  if v_from_till and (v_method <> 'cash' or v_branch is null) then
    raise exception 'Only a cash payment with a branch can be taken from the till' using errcode = '22023';
  end if;
  select s.name into v_name from public.suppliers s where s.id = v_supplier and s.tenant_id = v_tenant;
  if v_name is null then
    raise exception 'Supplier not found' using errcode = '22023';
  end if;

  if v_client is not null and exists (select 1 from public.supplier_payments p where p.tenant_id = v_tenant and p.client_uuid = v_client) then
    select coalesce(sum(l.amount), 0) into v_balance from public.supplier_ledger l where l.tenant_id = v_tenant and l.supplier_id = v_supplier;
    return jsonb_build_object('supplier', v_name, 'amount', v_amount, 'balance_after', v_balance, 'duplicate', true);
  end if;

  if v_from_till then
    select cs.id into v_session from public.cash_sessions cs
     where cs.tenant_id = v_tenant and cs.branch_id = v_branch and cs.opened_by = auth.uid() and cs.status = 'open';
    if v_session is null then
      insert into public.cash_sessions (tenant_id, branch_id, opened_by, opening_float)
      values (v_tenant, v_branch, auth.uid(), 0) returning id into v_session;
    end if;
  end if;

  insert into public.supplier_payments (tenant_id, branch_id, supplier_id, method, amount, reference, paid_by, note, client_uuid, cash_session_id)
  values (v_tenant, v_branch, v_supplier, v_method::public.payment_method, v_amount, v_ref, auth.uid(), v_note, v_client, v_session)
  returning id into v_pay;

  insert into public.supplier_ledger (tenant_id, supplier_id, entry_type, amount, payment_id, note, created_by)
  values (v_tenant, v_supplier, 'payment', -v_amount, v_pay,
          'Payment (' || v_method || ')' || coalesce(' ' || v_ref, '') || coalesce(' - ' || v_note, ''), auth.uid());

  select coalesce(sum(l.amount), 0) into v_balance from public.supplier_ledger l where l.tenant_id = v_tenant and l.supplier_id = v_supplier;
  return jsonb_build_object('supplier', v_name, 'amount', v_amount, 'balance_after', v_balance);
end $$;

-- ---------------------------------------------------------------------
-- session_totals v2: cash out for supplier payments from the till
-- ---------------------------------------------------------------------
create or replace function public.session_totals(p_session_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_tenant uuid := private.tenant_id();
  s public.cash_sessions;
  v_cash numeric; v_mpesa numeric; v_bank numeric; v_other numeric;
  v_refunds numeric; v_expenses numeric; v_supp numeric; v_count int; v_sales numeric;
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
     and r.processed_by = s.opened_by   -- a refund comes out of the till of the person who gave it
     and r.created_at >= s.opened_at and (s.closed_at is null or r.created_at <= s.closed_at);

  select coalesce(sum(x.amount), 0) into v_expenses
    from public.expenses x where x.cash_session_id = s.id and x.method = 'cash';

  select coalesce(sum(sp.amount), 0) into v_supp
    from public.supplier_payments sp where sp.cash_session_id = s.id and sp.method = 'cash';

  select count(*), coalesce(sum(sa.total), 0) into v_count, v_sales
    from public.sales sa where sa.cash_session_id = s.id and sa.status <> 'voided';

  return jsonb_build_object(
    'session_id', s.id, 'status', s.status, 'opened_at', s.opened_at, 'closed_at', s.closed_at,
    'opening_float', s.opening_float,
    'cash_in', v_cash, 'mpesa_in', v_mpesa, 'bank_in', v_bank, 'other_in', v_other,
    'cash_refunds', v_refunds, 'cash_expenses', v_expenses, 'cash_supplier_payments', v_supp,
    'expected_cash', s.opening_float + v_cash - v_refunds - v_expenses - v_supp,
    'sales_count', v_count, 'sales_total', v_sales,
    'counted_cash', s.counted_cash, 'cash_variance', s.cash_variance);
end $$;

-- =====================================================================
-- REPORTS (owner / manager). Dates are Kenya dates, both ends included.
-- Sales: voided and held sales are left out. Returns reduce sales and cost.
-- Profit uses the buying price recorded on each sale line at the time of sale.
-- =====================================================================

create or replace function public.report_profit(p_from date, p_to date, p_branch uuid default null)
returns jsonb
language plpgsql stable set search_path = ''
as $$
declare
  t_from timestamptz := (p_from::timestamp at time zone 'Africa/Nairobi');
  t_to   timestamptz := ((p_to + 1)::timestamp at time zone 'Africa/Nairobi');
  v_count bigint; v_gross numeric; v_disc numeric; v_vat numeric; v_credit numeric;
  v_cogs numeric; v_returns numeric; v_rcogs numeric; v_exp numeric; v_supp numeric;
  v_collected jsonb; v_cats jsonb;
begin
  if not private.has_role(array['owner','manager']) then
    raise exception 'Only the owner or a manager can see reports' using errcode = '42501';
  end if;
  if p_to < p_from or p_to - p_from > 366 then
    raise exception 'Choose a period of up to one year' using errcode = '22023';
  end if;

  select count(*), coalesce(sum(s.total), 0), coalesce(sum(s.discount_total), 0),
         coalesce(sum(s.tax_total), 0), coalesce(sum(s.total - s.amount_paid), 0)
    into v_count, v_gross, v_disc, v_vat, v_credit
    from public.sales s
   where s.sold_at >= t_from and s.sold_at < t_to and s.status not in ('voided','held')
     and (p_branch is null or s.branch_id = p_branch);

  select coalesce(sum(si.quantity * si.unit_cost), 0) into v_cogs
    from public.sale_items si join public.sales s on s.id = si.sale_id and s.tenant_id = si.tenant_id
   where s.sold_at >= t_from and s.sold_at < t_to and s.status not in ('voided','held')
     and (p_branch is null or s.branch_id = p_branch);

  select coalesce(sum(r.total_refund), 0) into v_returns
    from public.sale_returns r
   where r.created_at >= t_from and r.created_at < t_to and (p_branch is null or r.branch_id = p_branch);

  select coalesce(sum(ri.quantity * si.unit_cost), 0) into v_rcogs
    from public.sale_return_items ri
    join public.sale_items si on si.id = ri.sale_item_id and si.tenant_id = ri.tenant_id
    join public.sale_returns r on r.id = ri.return_id and r.tenant_id = ri.tenant_id
   where ri.restock and r.created_at >= t_from and r.created_at < t_to and (p_branch is null or r.branch_id = p_branch);

  select coalesce(sum(e.amount), 0) into v_exp
    from public.expenses e
   where e.incurred_on between p_from and p_to and (p_branch is null or e.branch_id = p_branch);

  select coalesce(jsonb_agg(jsonb_build_object('category', x.name, 'total', x.total) order by x.total desc), '[]'::jsonb) into v_cats
    from (select coalesce(c.name, 'Other') as name, sum(e.amount) as total
            from public.expenses e left join public.expense_categories c on c.id = e.category_id and c.tenant_id = e.tenant_id
           where e.incurred_on between p_from and p_to and (p_branch is null or e.branch_id = p_branch)
           group by 1) x;

  select coalesce(sum(sp.amount), 0) into v_supp
    from public.supplier_payments sp
   where sp.paid_at >= t_from and sp.paid_at < t_to and (p_branch is null or sp.branch_id = p_branch);

  select jsonb_build_object(
           'cash',  coalesce(sum(p.amount) filter (where p.method = 'cash'), 0),
           'mpesa', coalesce(sum(p.amount) filter (where p.method = 'mpesa'), 0),
           'bank',  coalesce(sum(p.amount) filter (where p.method = 'bank'), 0),
           'other', coalesce(sum(p.amount) filter (where p.method = 'other'), 0))
    into v_collected
    from public.payments p
    left join public.sales sa on sa.id = p.sale_id and sa.tenant_id = p.tenant_id
   where p.paid_at >= t_from and p.paid_at < t_to and (p_branch is null or p.branch_id = p_branch)
     and (sa.id is null or sa.status <> 'voided');

  return jsonb_build_object(
    'from', p_from, 'to', p_to,
    'sales_count', v_count, 'gross_sales', v_gross, 'discounts', v_disc, 'returns', v_returns,
    'net_sales', v_gross - v_returns,
    'cogs', v_cogs - v_rcogs,
    'gross_profit', (v_gross - v_returns) - (v_cogs - v_rcogs),
    'expenses', v_exp,
    'net_profit', (v_gross - v_returns) - (v_cogs - v_rcogs) - v_exp,
    'vat_in_sales', v_vat, 'credit_given', v_credit,
    'collected', v_collected, 'supplier_payments', v_supp, 'expenses_by_category', v_cats);
end $$;

create or replace function public.report_daily(p_from date, p_to date, p_branch uuid default null)
returns table (day date, sales_count bigint, net_sales numeric, cogs numeric, gross_profit numeric, expenses numeric)
language plpgsql stable set search_path = ''
as $$
declare
  t_from timestamptz := (p_from::timestamp at time zone 'Africa/Nairobi');
  t_to   timestamptz := ((p_to + 1)::timestamp at time zone 'Africa/Nairobi');
begin
  if not private.has_role(array['owner','manager']) then
    raise exception 'Only the owner or a manager can see reports' using errcode = '42501';
  end if;
  if p_to < p_from or p_to - p_from > 366 then
    raise exception 'Choose a period of up to one year' using errcode = '22023';
  end if;

  return query
  with days as (select g::date as d from generate_series(p_from, p_to, interval '1 day') g),
  s as (select (sa.sold_at at time zone 'Africa/Nairobi')::date as d, count(*) as n, sum(sa.total) as t
          from public.sales sa
         where sa.sold_at >= t_from and sa.sold_at < t_to and sa.status not in ('voided','held') and (p_branch is null or sa.branch_id = p_branch)
         group by 1),
  c as (select (sa.sold_at at time zone 'Africa/Nairobi')::date as d, sum(si.quantity * si.unit_cost) as t
          from public.sale_items si join public.sales sa on sa.id = si.sale_id and sa.tenant_id = si.tenant_id
         where sa.sold_at >= t_from and sa.sold_at < t_to and sa.status not in ('voided','held') and (p_branch is null or sa.branch_id = p_branch)
         group by 1),
  r as (select (rr.created_at at time zone 'Africa/Nairobi')::date as d, sum(rr.total_refund) as t
          from public.sale_returns rr
         where rr.created_at >= t_from and rr.created_at < t_to and (p_branch is null or rr.branch_id = p_branch)
         group by 1),
  rc as (select (rr.created_at at time zone 'Africa/Nairobi')::date as d, sum(ri.quantity * si.unit_cost) as t
           from public.sale_return_items ri
           join public.sale_items si on si.id = ri.sale_item_id and si.tenant_id = ri.tenant_id
           join public.sale_returns rr on rr.id = ri.return_id and rr.tenant_id = ri.tenant_id
          where ri.restock and rr.created_at >= t_from and rr.created_at < t_to and (p_branch is null or rr.branch_id = p_branch)
          group by 1),
  e as (select x.incurred_on as d, sum(x.amount) as t
          from public.expenses x
         where x.incurred_on between p_from and p_to and (p_branch is null or x.branch_id = p_branch)
         group by 1)
  select days.d,
         coalesce(s.n, 0),
         coalesce(s.t, 0) - coalesce(r.t, 0),
         coalesce(c.t, 0) - coalesce(rc.t, 0),
         (coalesce(s.t, 0) - coalesce(r.t, 0)) - (coalesce(c.t, 0) - coalesce(rc.t, 0)),
         coalesce(e.t, 0)
    from days
    left join s on s.d = days.d left join c on c.d = days.d left join r on r.d = days.d
    left join rc on rc.d = days.d left join e on e.d = days.d
   order by days.d;
end $$;

create or replace function public.report_top_products(
  p_from date, p_to date, p_branch uuid default null, p_limit int default 20, p_order text default 'revenue'
) returns table (product_id uuid, name text, sku text, qty numeric, revenue numeric, profit numeric)
language plpgsql stable set search_path = ''
as $$
declare
  t_from timestamptz := (p_from::timestamp at time zone 'Africa/Nairobi');
  t_to   timestamptz := ((p_to + 1)::timestamp at time zone 'Africa/Nairobi');
begin
  if not private.has_role(array['owner','manager']) then
    raise exception 'Only the owner or a manager can see reports' using errcode = '42501';
  end if;
  if p_to < p_from or p_to - p_from > 366 then
    raise exception 'Choose a period of up to one year' using errcode = '22023';
  end if;

  return query
  select x.product_id, x.name, x.sku, x.qty, x.revenue, x.profit
    from (
      select si.product_id as product_id, max(si.product_name) as name, max(si.sku) as sku,
             sum(si.quantity - si.returned_qty) as qty,
             sum(si.line_total * (si.quantity - si.returned_qty) / si.quantity) as revenue,
             sum(si.line_total * (si.quantity - si.returned_qty) / si.quantity - (si.quantity - si.returned_qty) * si.unit_cost) as profit
        from public.sale_items si join public.sales s on s.id = si.sale_id and s.tenant_id = si.tenant_id
       where s.sold_at >= t_from and s.sold_at < t_to and s.status not in ('voided','held')
         and (p_branch is null or s.branch_id = p_branch)
       group by si.product_id
    ) x
   where x.qty > 0
   order by case p_order when 'qty' then x.qty when 'profit' then x.profit else x.revenue end desc
   limit greatest(1, least(coalesce(p_limit, 20), 200));
end $$;

create or replace function public.report_slow_stock(p_days int default 60, p_branch uuid default null)
returns table (product_id uuid, name text, sku text, stock_qty numeric, cost_price numeric, stock_value numeric, last_sold_at timestamptz)
language plpgsql stable set search_path = ''
as $$
begin
  if not private.has_role(array['owner','manager']) then
    raise exception 'Only the owner or a manager can see reports' using errcode = '42501';
  end if;
  return query
  select p.id, p.name, p.sku, st.qty, coalesce(pc.cost_price, 0), st.qty * coalesce(pc.cost_price, 0), ls.last_sold
    from public.products p
    join lateral (select sum(sl.quantity) as qty from public.stock_levels sl
                   where sl.product_id = p.id and (p_branch is null or sl.branch_id = p_branch)) st on true
    left join public.product_costs pc on pc.product_id = p.id
    left join lateral (select max(s.sold_at) as last_sold
                         from public.sale_items si join public.sales s on s.id = si.sale_id and s.tenant_id = si.tenant_id
                        where si.product_id = p.id and s.status not in ('voided','held')
                          and (p_branch is null or s.branch_id = p_branch)) ls on true
   where p.is_active and p.deleted_at is null and p.track_stock and coalesce(st.qty, 0) > 0
     and (ls.last_sold is null or ls.last_sold < now() - make_interval(days => greatest(p_days, 1)))
   order by st.qty * coalesce(pc.cost_price, 0) desc
   limit 200;
end $$;

create or replace function public.report_stock_value(p_branch uuid default null)
returns table (category text, items bigint, units numeric, cost_value numeric, retail_value numeric)
language plpgsql stable set search_path = ''
as $$
begin
  if not private.has_role(array['owner','manager']) then
    raise exception 'Only the owner or a manager can see reports' using errcode = '42501';
  end if;
  return query
  select coalesce(c.name, 'No category'), count(*), sum(st.qty),
         sum(st.qty * coalesce(pc.cost_price, 0)), sum(st.qty * p.selling_price)
    from public.products p
    left join public.product_categories c on c.id = p.category_id
    join lateral (select sum(sl.quantity) as qty from public.stock_levels sl
                   where sl.product_id = p.id and (p_branch is null or sl.branch_id = p_branch)) st on true
    left join public.product_costs pc on pc.product_id = p.id
   where p.is_active and p.deleted_at is null and p.track_stock and coalesce(st.qty, 0) > 0
   group by 1
   order by 4 desc;
end $$;

create or replace function public.report_staff(p_from date, p_to date, p_branch uuid default null)
returns table (user_id uuid, sales_count bigint, revenue numeric, discounts numeric, voided bigint, flagged bigint)
language plpgsql stable set search_path = ''
as $$
declare
  t_from timestamptz := (p_from::timestamp at time zone 'Africa/Nairobi');
  t_to   timestamptz := ((p_to + 1)::timestamp at time zone 'Africa/Nairobi');
begin
  if not private.has_role(array['owner','manager']) then
    raise exception 'Only the owner or a manager can see reports' using errcode = '42501';
  end if;
  if p_to < p_from or p_to - p_from > 366 then
    raise exception 'Choose a period of up to one year' using errcode = '22023';
  end if;
  return query
  select s.cashier_id,
         count(*) filter (where s.status not in ('voided','held')),
         coalesce(sum(s.total) filter (where s.status not in ('voided','held')), 0),
         coalesce(sum(s.discount_total + ld.d) filter (where s.status not in ('voided','held')), 0),
         count(*) filter (where s.status = 'voided'),
         count(*) filter (where cardinality(s.offline_flags) > 0)
    from public.sales s
    join lateral (select coalesce(sum(si.discount_amount), 0) as d from public.sale_items si where si.sale_id = s.id) ld on true
   where s.sold_at >= t_from and s.sold_at < t_to and s.status <> 'held' and (p_branch is null or s.branch_id = p_branch)
   group by s.cashier_id
   order by 3 desc;
end $$;

-- ---------------------------------------------------------------------
revoke execute on function public.record_expense(jsonb) from public, anon;
revoke execute on function public.delete_expense(uuid, text) from public, anon;
revoke execute on function public.report_profit(date, date, uuid) from public, anon;
revoke execute on function public.report_daily(date, date, uuid) from public, anon;
revoke execute on function public.report_top_products(date, date, uuid, int, text) from public, anon;
revoke execute on function public.report_slow_stock(int, uuid) from public, anon;
revoke execute on function public.report_stock_value(uuid) from public, anon;
revoke execute on function public.report_staff(date, date, uuid) from public, anon;
grant execute on function public.record_expense(jsonb) to authenticated;
grant execute on function public.delete_expense(uuid, text) to authenticated;
grant execute on function public.report_profit(date, date, uuid) to authenticated;
grant execute on function public.report_daily(date, date, uuid) to authenticated;
grant execute on function public.report_top_products(date, date, uuid, int, text) to authenticated;
grant execute on function public.report_slow_stock(int, uuid) to authenticated;
grant execute on function public.report_stock_value(uuid) to authenticated;
grant execute on function public.report_staff(date, date, uuid) to authenticated;
