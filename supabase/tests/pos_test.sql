-- =====================================================================
-- Phase 5a TEST: selling, discounts, credit, returns, tills.
-- Paste the whole file in the Supabase SQL Editor and click Run.
-- It ends with an ERROR on purpose: the error text is the report and it
-- rolls back all fake data. Every line should start with a tick.
-- =====================================================================
do $test$
declare
  report text := '';
  st text; n bigint; q numeric; txt text; res jsonb; res2 jsonb; sid uuid; sid2 uuid; sid3 uuid;
  t   uuid := gen_random_uuid();
  uo  uuid := gen_random_uuid();   -- owner
  um  uuid := gen_random_uuid();   -- manager (max discount 30)
  uc  uuid := gen_random_uuid();   -- cashier  (max discount 5), branch 1
  uc2 uuid := gen_random_uuid();   -- cashier, branch 2 (till test)
  br1 uuid := gen_random_uuid();
  br2 uuid := gen_random_uuid();
  p1 uuid; p2 uuid; c1 uuid := gen_random_uuid(); c2 uuid := gen_random_uuid();
  plan_id uuid; sess uuid; ret jsonb; item uuid;
  c_owner text; c_mgr text; c_cash text; c_cash2 text;
begin
  ---------------------------------------------------------------- SETUP
  insert into auth.users (id, email) values
    (uo, 'pos-owner@test.local'), (um, 'pos-mgr@test.local'), (uc, 'pos-cash@test.local'), (uc2, 'pos-cash2@test.local');
  insert into public.plans (code, name) values ('zz-pos', 'POS test plan') returning id into plan_id;
  insert into public.tenants (id, name, slug, vat_registered, vat_rate) values (t, 'POS Test Shop', 'pos-test-shop', true, 16);
  insert into public.subscriptions (tenant_id, plan_id, status) values (t, plan_id, 'active');
  insert into public.branches (id, tenant_id, name, code) values (br1, t, 'Main', 'BR1'), (br2, t, 'Second', 'BR2');
  insert into public.tenant_members (tenant_id, user_id, role, all_branches, max_discount_pct) values
    (t, uo, 'owner', true, 100), (t, um, 'manager', true, 30), (t, uc, 'cashier', true, 5), (t, uc2, 'cashier', true, 5);

  insert into public.products (tenant_id, sku, name, selling_price, wholesale_price) values (t, 'P1', 'Brake Pad', 1000, 900) returning id into p1;
  insert into public.products (tenant_id, sku, name, selling_price) values (t, 'P2', 'Spark Plug', 232) returning id into p2;
  insert into public.product_costs (tenant_id, product_id, cost_price, min_selling_price) values (t, p1, 600, 800), (t, p2, 100, null);
  insert into public.stock_movements (tenant_id, branch_id, product_id, movement_type, quantity, reason)
    values (t, br1, p1, 'opening', 10, 'Opening stock');
  insert into public.customers (id, tenant_id, name, credit_limit) values (c1, t, 'Credit Customer', 5000), (c2, t, 'No Credit Customer', 0);

  c_owner := json_build_object('sub', uo, 'role', 'authenticated', 'tenant_id', t, 'tenant_role', 'owner', 'all_branches', true, 'branch_ids', json_build_array(), 'max_discount_pct', 100)::text;
  c_mgr   := json_build_object('sub', um, 'role', 'authenticated', 'tenant_id', t, 'tenant_role', 'manager', 'all_branches', true, 'branch_ids', json_build_array(), 'max_discount_pct', 30)::text;
  c_cash  := json_build_object('sub', uc, 'role', 'authenticated', 'tenant_id', t, 'tenant_role', 'cashier', 'all_branches', true, 'branch_ids', json_build_array(), 'max_discount_pct', 5)::text;
  c_cash2 := json_build_object('sub', uc2, 'role', 'authenticated', 'tenant_id', t, 'tenant_role', 'cashier', 'all_branches', true, 'branch_ids', json_build_array(), 'max_discount_pct', 5)::text;

  ---------------------------------------------------------------- CASHIER SELLS
  perform set_config('request.jwt.claims', c_cash, true);
  set local role authenticated;

  res := public.complete_sale(jsonb_build_object('client_uuid', gen_random_uuid(), 'branch_id', br1,
    'items', jsonb_build_array(jsonb_build_object('product_id', p1, 'qty', 2, 'unit_price', 1000)),
    'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 2000))));
  sid := (res ->> 'sale_id')::uuid;
  report := report || case when (res ->> 'total')::numeric = 2000 and (res ->> 'balance_due')::numeric = 0 and (res ->> 'receipt_no') = 'BR1-000001'
                      then '✅' else '❌' end || ' cash sale: total 2000, paid in full, receipt BR1-000001 (got ' || res::text || ')' || chr(10);
  reset role;

  select quantity into q from public.stock_levels where branch_id = br1 and product_id = p1;
  report := report || case when q = 8 then '✅' else '❌' end || ' stock went from 10 to 8 (got ' || coalesce(q::text,'null') || ')' || chr(10);
  select count(*) into n from public.cash_sessions where tenant_id = t and branch_id = br1 and opened_by = uc and status = 'open';
  report := report || case when n = 1 then '✅' else '❌' end || ' a till was opened automatically for the cashier' || chr(10);

  -- same sale sent twice
  perform set_config('request.jwt.claims', c_cash, true);
  set local role authenticated;
  res := public.complete_sale(jsonb_build_object('client_uuid', '11111111-1111-1111-1111-111111111111', 'branch_id', br1,
    'items', jsonb_build_array(jsonb_build_object('product_id', p1, 'qty', 1)),
    'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 1000))));
  res2 := public.complete_sale(jsonb_build_object('client_uuid', '11111111-1111-1111-1111-111111111111', 'branch_id', br1,
    'items', jsonb_build_array(jsonb_build_object('product_id', p1, 'qty', 1)),
    'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 1000))));
  reset role;
  select count(*) into n from public.sales where client_uuid = '11111111-1111-1111-1111-111111111111';
  select quantity into q from public.stock_levels where branch_id = br1 and product_id = p1;
  report := report || case when n = 1 and q = 7 and (res2 ->> 'sale_id') = (res ->> 'sale_id') then '✅' else '❌' end || ' sending the same sale twice records it once (sales ' || n || ', stock ' || coalesce(q::text,'null') || ')' || chr(10);

  -- discount rules
  perform set_config('request.jwt.claims', c_cash, true);
  set local role authenticated;
  st := 'none';
  begin perform public.complete_sale(jsonb_build_object('branch_id', br1,
      'items', jsonb_build_array(jsonb_build_object('product_id', p1, 'qty', 1, 'unit_price', 900)),
      'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 900)));
  exception when others then st := sqlstate; end;
  report := report || case when st = 'P0001' then '✅' else '❌' end || ' cashier cannot give a 10% discount (limit 5%) (sqlstate ' || st || ')' || chr(10);

  st := 'none';
  begin perform public.complete_sale(jsonb_build_object('branch_id', br1,
      'items', jsonb_build_array(jsonb_build_object('product_id', p1, 'qty', 1, 'unit_price', 960)),
      'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 960)));
  exception when others then st := sqlstate; end;
  report := report || case when st = 'none' then '✅' else '❌' end || ' cashier CAN give a 4% discount (sqlstate ' || st || ')' || chr(10);

  st := 'none';
  begin perform public.complete_sale(jsonb_build_object('branch_id', br1,
      'items', jsonb_build_array(jsonb_build_object('product_id', p1, 'qty', 1)),
      'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 500)));
  exception when others then st := sqlstate; end;
  report := report || case when st = '22023' then '✅' else '❌' end || ' part payment without a customer is refused (sqlstate ' || st || ')' || chr(10);

  st := 'none';
  begin insert into public.sales (branch_id, receipt_no, cashier_id, status) values (br1, 'HACK-1', uc, 'completed');
  exception when others then st := sqlstate; end;
  report := report || case when st = '42501' then '✅' else '❌' end || ' sales cannot be inserted by hand (sqlstate ' || st || ')' || chr(10);

  -- credit
  res := public.complete_sale(jsonb_build_object('branch_id', br1, 'customer_id', c1,
    'items', jsonb_build_array(jsonb_build_object('product_id', p1, 'qty', 1)),
    'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 400))));
  sid2 := (res ->> 'sale_id')::uuid;
  select balance into q from public.customer_balances where customer_id = c1;
  report := report || case when q = 600 then '✅' else '❌' end || ' credit sale 1000 with 400 paid: customer owes 600 (got ' || coalesce(q::text,'null') || ')' || chr(10);

  st := 'none';
  begin perform public.complete_sale(jsonb_build_object('branch_id', br1, 'customer_id', c1,
      'items', jsonb_build_array(jsonb_build_object('product_id', p1, 'qty', 5)), 'payments', '[]'::jsonb));
  exception when others then st := sqlstate; end;
  report := report || case when st = 'P0001' then '✅' else '❌' end || ' credit limit (5000) cannot be exceeded (sqlstate ' || st || ')' || chr(10);

  st := 'none';
  begin perform public.complete_sale(jsonb_build_object('branch_id', br1, 'customer_id', c2,
      'items', jsonb_build_array(jsonb_build_object('product_id', p1, 'qty', 1)), 'payments', '[]'::jsonb));
  exception when others then st := sqlstate; end;
  report := report || case when st = 'P0001' then '✅' else '❌' end || ' a customer with no credit cannot buy on credit (sqlstate ' || st || ')' || chr(10);

  st := 'none';
  begin insert into public.customers (name, credit_limit) values ('Sneaky', 100000);
  exception when others then st := sqlstate; end;
  report := report || case when st = '42501' then '✅' else '❌' end || ' a cashier cannot create a customer with a credit limit (sqlstate ' || st || ')' || chr(10);

  -- M-Pesa
  res := public.complete_sale(jsonb_build_object('branch_id', br1,
    'items', jsonb_build_array(jsonb_build_object('product_id', p2, 'qty', 1)),
    'payments', jsonb_build_array(jsonb_build_object('method', 'mpesa', 'amount', 232, 'reference', 'qwe1234567'))));
  st := 'none';
  begin perform public.complete_sale(jsonb_build_object('branch_id', br1,
      'items', jsonb_build_array(jsonb_build_object('product_id', p2, 'qty', 1)),
      'payments', jsonb_build_array(jsonb_build_object('method', 'mpesa', 'amount', 232, 'reference', 'QWE1234567'))));
  exception when others then st := sqlstate; end;
  report := report || case when st = '23505' then '✅' else '❌' end || ' the same M-Pesa code cannot be used on two sales (sqlstate ' || st || ')' || chr(10);

  st := 'none';
  begin perform public.complete_sale(jsonb_build_object('branch_id', br1,
      'items', jsonb_build_array(jsonb_build_object('product_id', p2, 'qty', 1)),
      'payments', jsonb_build_array(jsonb_build_object('method', 'mpesa', 'amount', 232))));
  exception when others then st := sqlstate; end;
  report := report || case when st = '22023' then '✅' else '❌' end || ' an M-Pesa payment needs a code (sqlstate ' || st || ')' || chr(10);

  -- wholesale tier + VAT
  res := public.complete_sale(jsonb_build_object('branch_id', br1, 'price_tier', 'wholesale',
    'items', jsonb_build_array(jsonb_build_object('product_id', p1, 'qty', 1)),
    'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 900))));
  report := report || case when (res ->> 'total')::numeric = 900 then '✅' else '❌' end || ' wholesale price 900 is used (got ' || (res ->> 'total') || ')' || chr(10);

  res := public.complete_sale(jsonb_build_object('branch_id', br1,
    'items', jsonb_build_array(jsonb_build_object('product_id', p2, 'qty', 5)),
    'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 1160))));
  sid3 := (res ->> 'sale_id')::uuid;
  reset role;
  select tax_total into q from public.sales where id = sid3;
  report := report || case when q = 160 then '✅' else '❌' end || ' VAT inside 1160 is 160 (got ' || coalesce(q::text,'null') || ')' || chr(10);

  ---------------------------------------------------------------- PRICE FLOOR: manager blocked, owner allowed
  perform set_config('request.jwt.claims', c_mgr, true);
  set local role authenticated;
  st := 'none';
  begin perform public.complete_sale(jsonb_build_object('branch_id', br1,
      'items', jsonb_build_array(jsonb_build_object('product_id', p1, 'qty', 1, 'unit_price', 790)),
      'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 790))));
  exception when others then st := sqlstate; end;
  report := report || case when st = 'P0001' then '✅' else '❌' end || ' a manager cannot sell below the lowest allowed price (sqlstate ' || st || ')' || chr(10);
  reset role;

  perform set_config('request.jwt.claims', c_owner, true);
  set local role authenticated;
  st := 'none';
  begin perform public.complete_sale(jsonb_build_object('branch_id', br1,
      'items', jsonb_build_array(jsonb_build_object('product_id', p1, 'qty', 1, 'unit_price', 790)),
      'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 790))));
  exception when others then st := sqlstate; end;
  report := report || case when st = 'none' then '✅' else '❌' end || ' the owner can sell below the floor (sqlstate ' || st || ')' || chr(10);
  reset role;

  ---------------------------------------------------------------- VOID AND RETURNS
  perform set_config('request.jwt.claims', c_cash, true);
  set local role authenticated;
  st := 'none';
  begin perform public.void_sale(sid, 'mistake');
  exception when others then st := sqlstate; end;
  report := report || case when st = '42501' then '✅' else '❌' end || ' a cashier cannot cancel a sale (sqlstate ' || st || ')' || chr(10);
  reset role;

  -- void the credit sale as manager: debt must disappear except the 400 already paid
  perform set_config('request.jwt.claims', c_mgr, true);
  set local role authenticated;
  perform public.void_sale(sid2, 'Customer changed mind');
  reset role;
  select balance into q from public.customer_balances where customer_id = c1;
  report := report || case when q = -400 then '✅' else '❌' end || ' voiding the credit sale clears the debt (400 paid stays as credit) (got ' || coalesce(q::text,'null') || ')' || chr(10);

  -- return 1 of the 2 pads from the first sale
  select id into item from public.sale_items where sale_id = sid;
  select quantity into q from public.stock_levels where branch_id = br1 and product_id = p1;
  perform set_config('request.jwt.claims', c_mgr, true);
  set local role authenticated;
  ret := public.return_items(sid, jsonb_build_array(jsonb_build_object('sale_item_id', item, 'qty', 1, 'restock', true)), 'cash', 'Wrong part');
  reset role;
  report := report || case when (ret ->> 'refund')::numeric = 1000 and (ret ->> 'return_no') = 'RT-BR1-000001' then '✅' else '❌' end || ' returning 1 of 2 refunds 1000 with number RT-BR1-000001 (got ' || ret::text || ')' || chr(10);
  select count(*) into n from public.sales where id = sid and status = 'partially_returned';
  report := report || case when n = 1 then '✅' else '❌' end || ' the sale is now "partially returned"' || chr(10);
  select quantity into txt from public.stock_levels where branch_id = br1 and product_id = p1;
  report := report || case when txt::numeric = q + 1 then '✅' else '❌' end || ' the returned item went back into stock' || chr(10);

  perform set_config('request.jwt.claims', c_mgr, true);
  set local role authenticated;
  st := 'none';
  begin perform public.return_items(sid, jsonb_build_array(jsonb_build_object('sale_item_id', item, 'qty', 5)), 'cash', 'Too many');
  exception when others then st := sqlstate; end;
  report := report || case when st = '22023' then '✅' else '❌' end || ' cannot return more than was bought (sqlstate ' || st || ')' || chr(10);
  reset role;

  perform set_config('request.jwt.claims', c_cash, true);
  set local role authenticated;
  st := 'none';
  begin perform public.return_items(sid, jsonb_build_array(jsonb_build_object('sale_item_id', item, 'qty', 1)), 'cash', 'Cashier return');
  exception when others then st := sqlstate; end;
  report := report || case when st = '42501' then '✅' else '❌' end || ' a cashier cannot take items back (sqlstate ' || st || ')' || chr(10);
  reset role;

  ---------------------------------------------------------------- TILL: open, sell, close
  perform set_config('request.jwt.claims', c_cash2, true);
  set local role authenticated;
  sess := public.open_cash_session(br2, 500);
  perform public.complete_sale(jsonb_build_object('branch_id', br2,
    'items', jsonb_build_array(jsonb_build_object('product_id', p2, 'qty', 1)),
    'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 232))));
  perform public.complete_sale(jsonb_build_object('branch_id', br2,
    'items', jsonb_build_array(jsonb_build_object('product_id', p2, 'qty', 1)),
    'payments', jsonb_build_array(jsonb_build_object('method', 'mpesa', 'amount', 232, 'reference', 'TILL000001'))));
  res := public.close_cash_session(sess, 700, 'End of day');
  reset role;
  report := report || case when (res ->> 'expected_cash')::numeric = 732 and (res ->> 'mpesa_in')::numeric = 232 and (res ->> 'cash_variance')::numeric = -32
                      then '✅' else '❌' end || ' till: float 500 + cash 232 = 732 expected, counted 700 = variance -32 (got ' || res::text || ')' || chr(10);

  perform set_config('request.jwt.claims', c_cash, true);
  set local role authenticated;
  st := 'none';
  begin perform public.session_totals(sess);
  exception when others then st := sqlstate; end;
  reset role;
  report := report || case when st = '42501' then '✅' else '❌' end || ' a cashier cannot look at another cashier''s till (sqlstate ' || st || ')' || chr(10);

  raise exception E'\n\n===== PHASE 5a TEST REPORT =====\n%\nThis "error" is expected: it rolls back all fake test data.\n', report;
end
$test$;
