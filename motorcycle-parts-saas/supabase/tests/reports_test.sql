-- =====================================================================
-- Phase 7 TEST: expenses, cash-up with expenses, and reports.
-- Paste the whole file in the Supabase SQL Editor and click Run.
-- It ends with an ERROR on purpose: the error text is the report and it
-- rolls back all fake data. Every line should start with a tick.
-- =====================================================================
do $test$
declare
  report text := '';
  st text; txt text; n bigint;
  q numeric; q2 numeric; q3 numeric; q4 numeric;
  j jsonb; res jsonb;
  s1 uuid; item uuid; e1 uuid; e2 uuid; sess_o uuid; sess_c uuid;
  t   uuid := gen_random_uuid();
  uo  uuid := gen_random_uuid();
  uc  uuid := gen_random_uuid();
  br1 uuid := gen_random_uuid();
  sup uuid := gen_random_uuid();
  pa uuid; pb uuid; pc uuid; plan_id uuid;
  d date := (now() at time zone 'Africa/Nairobi')::date;
  c_owner text; c_cash text;
begin
  ---------------------------------------------------------------- SETUP
  insert into auth.users (id, email) values (uo, 'rp-owner@test.local'), (uc, 'rp-cash@test.local');
  insert into public.plans (code, name) values ('zz-rp', 'Reports test plan') returning id into plan_id;
  insert into public.tenants (id, name, slug) values (t, 'Reports Test Shop', 'reports-test-shop');
  insert into public.subscriptions (tenant_id, plan_id, status) values (t, plan_id, 'active');
  insert into public.branches (id, tenant_id, name, code) values (br1, t, 'Main', 'RPT');
  insert into public.tenant_members (tenant_id, user_id, role, all_branches, max_discount_pct) values
    (t, uo, 'owner', true, 100), (t, uc, 'cashier', true, 5);

  insert into public.products (tenant_id, sku, name, selling_price) values (t, 'A', 'Part A', 1000) returning id into pa;
  insert into public.products (tenant_id, sku, name, selling_price) values (t, 'B', 'Part B', 500)  returning id into pb;
  insert into public.products (tenant_id, sku, name, selling_price) values (t, 'C', 'Part C', 150)  returning id into pc;
  insert into public.product_costs (tenant_id, product_id, cost_price) values (t, pa, 600), (t, pb, 300), (t, pc, 100);
  insert into public.stock_movements (tenant_id, branch_id, product_id, movement_type, quantity, reason) values
    (t, br1, pa, 'opening', 10, 'Opening stock'), (t, br1, pb, 'opening', 5, 'Opening stock'), (t, br1, pc, 'opening', 4, 'Opening stock');
  insert into public.suppliers (id, tenant_id, name) values (sup, t, 'Test Supplier');

  c_owner := json_build_object('sub', uo, 'role', 'authenticated', 'tenant_id', t, 'tenant_role', 'owner', 'all_branches', true, 'branch_ids', json_build_array(), 'max_discount_pct', 100)::text;
  c_cash  := json_build_object('sub', uc, 'role', 'authenticated', 'tenant_id', t, 'tenant_role', 'cashier', 'all_branches', true, 'branch_ids', json_build_array(), 'max_discount_pct', 5)::text;

  ---------------------------------------------------------------- SALES, EXPENSES, RETURN, SUPPLIER PAYMENT
  perform set_config('request.jwt.claims', c_owner, true);
  set local role authenticated;
  res := public.complete_sale(jsonb_build_object('branch_id', br1,
    'items', jsonb_build_array(jsonb_build_object('product_id', pa, 'qty', 2)),
    'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 2000))));
  s1 := (res ->> 'sale_id')::uuid;
  reset role;

  perform set_config('request.jwt.claims', c_cash, true);
  set local role authenticated;
  perform public.complete_sale(jsonb_build_object('branch_id', br1,
    'items', jsonb_build_array(jsonb_build_object('product_id', pb, 'qty', 3)),
    'payments', jsonb_build_array(jsonb_build_object('method', 'mpesa', 'amount', 1500, 'reference', 'RPT0000001'))));
  e1 := public.record_expense(jsonb_build_object('branch_id', br1, 'amount', 200, 'method', 'cash', 'description', 'Transport'));
  reset role;

  perform set_config('request.jwt.claims', c_owner, true);
  set local role authenticated;
  perform public.complete_sale(jsonb_build_object('branch_id', br1,
    'items', jsonb_build_array(jsonb_build_object('product_id', pa, 'qty', 1, 'unit_price', 900)),
    'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 900))));
  e2 := public.record_expense(jsonb_build_object('branch_id', br1, 'amount', 100, 'method', 'mpesa', 'description', 'Airtime'));
  reset role;

  select id into item from public.sale_items where sale_id = s1;
  perform set_config('request.jwt.claims', c_owner, true);
  set local role authenticated;
  perform public.return_items(s1, jsonb_build_array(jsonb_build_object('sale_item_id', item, 'qty', 1, 'restock', true)), 'cash', 'Wrong part');
  perform public.pay_supplier(jsonb_build_object('supplier_id', sup, 'branch_id', br1, 'amount', 150, 'method', 'cash', 'from_till', true));
  reset role;

  ---------------------------------------------------------------- PROFIT REPORT
  perform set_config('request.jwt.claims', c_owner, true);
  set local role authenticated;
  j := public.report_profit(d, d);
  reset role;
  report := report || case when (j ->> 'sales_count')::int = 3 and (j ->> 'gross_sales')::numeric = 4400 and (j ->> 'returns')::numeric = 1000 and (j ->> 'net_sales')::numeric = 3400
                      then '✅' else '❌' end || ' sales: 3 sales, 4400 gross, 1000 returned, 3400 net (got ' || (j ->> 'sales_count') || ', ' || (j ->> 'gross_sales') || ', ' || (j ->> 'returns') || ', ' || (j ->> 'net_sales') || ')' || chr(10);
  report := report || case when (j ->> 'cogs')::numeric = 2100 and (j ->> 'gross_profit')::numeric = 1300 then '✅' else '❌' end || ' cost of goods 2100, gross profit 1300 (got ' || (j ->> 'cogs') || ' and ' || (j ->> 'gross_profit') || ')' || chr(10);
  report := report || case when (j ->> 'expenses')::numeric = 300 and (j ->> 'net_profit')::numeric = 1000 then '✅' else '❌' end || ' expenses 300, net profit 1000 (got ' || (j ->> 'expenses') || ' and ' || (j ->> 'net_profit') || ')' || chr(10);
  report := report || case when (j -> 'collected' ->> 'cash')::numeric = 2900 and (j -> 'collected' ->> 'mpesa')::numeric = 1500 and (j ->> 'supplier_payments')::numeric = 150
                      then '✅' else '❌' end || ' money collected: cash 2900, M-Pesa 1500; supplier payments 150' || chr(10);

  ---------------------------------------------------------------- DAILY, TOP PRODUCTS, SLOW STOCK, STOCK VALUE, STAFF
  perform set_config('request.jwt.claims', c_owner, true);
  set local role authenticated;

  select r.sales_count, r.net_sales, r.cogs, r.gross_profit, r.expenses into n, q, q2, q3, q4 from public.report_daily(d, d) r;
  report := report || case when n = 3 and q = 3400 and q2 = 2100 and q3 = 1300 and q4 = 300 then '✅' else '❌' end || ' daily row for today: 3 sales, 3400 net, cost 2100, profit 1300, expenses 300' || chr(10);

  select r.name into txt from public.report_top_products(d, d, null, 5, 'revenue') r limit 1;
  select r.revenue, r.profit into q, q2 from public.report_top_products(d, d, null, 5, 'revenue') r where r.sku = 'A';
  report := report || case when txt = 'Part A' and q = 1900 and q2 = 700 then '✅' else '❌' end || ' best seller by money: Part A, revenue 1900, profit 700 (got ' || coalesce(txt,'null') || ', ' || coalesce(q::text,'null') || ', ' || coalesce(q2::text,'null') || ')' || chr(10);

  select r.name into txt from public.report_top_products(d, d, null, 5, 'qty') r limit 1;
  report := report || case when txt = 'Part B' then '✅' else '❌' end || ' best seller by quantity: Part B (3 sold) (got ' || coalesce(txt,'null') || ')' || chr(10);

  select count(*), max(r.name), max(r.stock_value) into n, txt, q from public.report_slow_stock(30) r;
  report := report || case when n = 1 and txt = 'Part C' and q = 400 then '✅' else '❌' end || ' slow stock: only Part C (never sold, 4 x 100 = 400) (got ' || n || ', ' || coalesce(txt,'null') || ', ' || coalesce(q::text,'null') || ')' || chr(10);

  select count(*), sum(r.cost_value), sum(r.retail_value), sum(r.units) into n, q, q2, q3 from public.report_stock_value() r;
  report := report || case when q = 5800 and q2 = 9600 and q3 = 14 then '✅' else '❌' end || ' stock value: 5800 at cost, 9600 at selling prices, 14 units (got ' || coalesce(q::text,'null') || ', ' || coalesce(q2::text,'null') || ', ' || coalesce(q3::text,'null') || ')' || chr(10);

  select count(*), sum(r.sales_count) into n, q from public.report_staff(d, d) r;
  select r.revenue into q2 from public.report_staff(d, d) r where r.user_id = uo;
  select r.revenue into q3 from public.report_staff(d, d) r where r.user_id = uc;
  report := report || case when n = 2 and q = 3 and q2 = 2900 and q3 = 1500 then '✅' else '❌' end || ' sales by staff: owner 2900, cashier 1500 (got ' || coalesce(q2::text,'null') || ' and ' || coalesce(q3::text,'null') || ')' || chr(10);
  reset role;

  ---------------------------------------------------------------- TILLS (cash out for expenses, refunds, supplier payments)
  select id into sess_o from public.cash_sessions where tenant_id = t and opened_by = uo;
  select id into sess_c from public.cash_sessions where tenant_id = t and opened_by = uc;

  perform set_config('request.jwt.claims', c_owner, true);
  set local role authenticated;
  j := public.session_totals(sess_o);
  res := public.session_totals(sess_c);
  reset role;
  report := report || case when (j ->> 'expected_cash')::numeric = 1750 and (j ->> 'cash_supplier_payments')::numeric = 150 and (j ->> 'cash_refunds')::numeric = 1000
                      then '✅' else '❌' end || ' owner till: cash sales 2900 - refund 1000 - supplier 150 = 1750 (got ' || (j ->> 'expected_cash') || ')' || chr(10);
  report := report || case when (res ->> 'expected_cash')::numeric = -200 and (res ->> 'cash_expenses')::numeric = 200 and (res ->> 'cash_refunds')::numeric = 0
                      then '✅' else '❌' end || ' cashier till: only their own cash expense (-200) and not the owner''s refund (got ' || (res ->> 'expected_cash') || ')' || chr(10);

  ---------------------------------------------------------------- EXPENSE RULES
  perform set_config('request.jwt.claims', c_cash, true);
  set local role authenticated;

  st := 'none';
  begin perform public.record_expense(jsonb_build_object('branch_id', br1, 'amount', 50, 'method', 'cash', 'description', 'Old', 'incurred_on', (d - 3)::text));
  exception when others then st := sqlstate; end;
  report := report || case when st = '42501' then '✅' else '❌' end || ' a cashier cannot back-date an expense (sqlstate ' || st || ')' || chr(10);

  st := 'none';
  begin perform public.record_expense(jsonb_build_object('branch_id', br1, 'amount', 0, 'description', 'Nothing'));
  exception when others then st := sqlstate; end;
  report := report || case when st = '22023' then '✅' else '❌' end || ' an expense of 0 is refused (sqlstate ' || st || ')' || chr(10);

  st := 'none';
  begin perform public.record_expense(jsonb_build_object('branch_id', br1, 'amount', 50));
  exception when others then st := sqlstate; end;
  report := report || case when st = '22023' then '✅' else '❌' end || ' an expense must say what it was for (sqlstate ' || st || ')' || chr(10);

  st := 'none';
  begin insert into public.expenses (branch_id, amount, method, description) values (br1, 5, 'cash', 'Sneaky');
  exception when others then st := sqlstate; end;
  report := report || case when st = '42501' then '✅' else '❌' end || ' expenses cannot be inserted by hand (sqlstate ' || st || ')' || chr(10);

  select count(*) into n from public.expenses;
  report := report || case when n = 1 then '✅' else '❌' end || ' a cashier sees only their own expenses (saw ' || n || ')' || chr(10);

  st := 'none';
  begin perform public.delete_expense(e1, 'trying');
  exception when others then st := sqlstate; end;
  report := report || case when st = '42501' then '✅' else '❌' end || ' a cashier cannot delete an expense (sqlstate ' || st || ')' || chr(10);

  st := 'none';
  begin perform public.report_profit(d, d);
  exception when others then st := sqlstate; end;
  report := report || case when st = '42501' then '✅' else '❌' end || ' a cashier cannot open reports (sqlstate ' || st || ')' || chr(10);
  reset role;

  perform set_config('request.jwt.claims', c_owner, true);
  set local role authenticated;
  perform public.delete_expense(e1, 'Entered twice');
  j := public.report_profit(d, d);
  reset role;
  select count(*) into n from public.audit_logs where tenant_id = t and action = 'expense_deleted';
  report := report || case when (j ->> 'expenses')::numeric = 100 and n = 1 then '✅' else '❌' end || ' the owner deleted an expense with a reason: expenses now 100, audit log has it (got ' || (j ->> 'expenses') || ', log ' || n || ')' || chr(10);

  raise exception E'\n\n===== PHASE 7 TEST REPORT =====\n%\nThis "error" is expected: it rolls back all fake test data.\n', report;
end
$test$;
