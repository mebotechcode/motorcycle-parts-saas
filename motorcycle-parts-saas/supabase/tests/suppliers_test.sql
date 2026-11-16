-- =====================================================================
-- Phase 6b TEST: suppliers, purchase orders, receiving goods, payments.
-- Paste the whole file in the Supabase SQL Editor and click Run.
-- It ends with an ERROR on purpose: the error text is the report and it
-- rolls back all fake data. Every line should start with a tick.
-- =====================================================================
do $test$
declare
  report text := '';
  st text; n bigint; q numeric; q2 numeric; res jsonb; j jsonb; txt text;
  po uuid; poi uuid;
  t   uuid := gen_random_uuid();
  uo  uuid := gen_random_uuid();   -- owner
  us  uuid := gen_random_uuid();   -- storekeeper
  uc  uuid := gen_random_uuid();   -- cashier
  br1 uuid := gen_random_uuid();
  s1  uuid := gen_random_uuid();
  p1 uuid; plan_id uuid;
  c_owner text; c_store text; c_cash text;
begin
  ---------------------------------------------------------------- SETUP
  insert into auth.users (id, email) values (uo, 'su-owner@test.local'), (us, 'su-store@test.local'), (uc, 'su-cash@test.local');
  insert into public.plans (code, name) values ('zz-su', 'Suppliers test plan') returning id into plan_id;
  insert into public.tenants (id, name, slug) values (t, 'Suppliers Test Shop', 'suppliers-test-shop');
  insert into public.subscriptions (tenant_id, plan_id, status) values (t, plan_id, 'active');
  insert into public.branches (id, tenant_id, name, code) values (br1, t, 'Main', 'SUP');
  insert into public.tenant_members (tenant_id, user_id, role, all_branches) values
    (t, uo, 'owner', true), (t, us, 'storekeeper', true), (t, uc, 'cashier', true);
  insert into public.products (tenant_id, sku, name, selling_price) values (t, 'S1', 'Supplied Part', 1000) returning id into p1;
  insert into public.product_costs (tenant_id, product_id, cost_price) values (t, p1, 500);
  insert into public.suppliers (id, tenant_id, name, phone, payment_terms_days) values (s1, t, 'Test Supplier', '0700111222', 30);

  c_owner := json_build_object('sub', uo, 'role', 'authenticated', 'tenant_id', t, 'tenant_role', 'owner', 'all_branches', true, 'branch_ids', json_build_array())::text;
  c_store := json_build_object('sub', us, 'role', 'authenticated', 'tenant_id', t, 'tenant_role', 'storekeeper', 'all_branches', true, 'branch_ids', json_build_array())::text;
  c_cash  := json_build_object('sub', uc, 'role', 'authenticated', 'tenant_id', t, 'tenant_role', 'cashier', 'all_branches', true, 'branch_ids', json_build_array())::text;

  ---------------------------------------------------------------- PURCHASE ORDER (storekeeper)
  perform set_config('request.jwt.claims', c_store, true);
  set local role authenticated;

  po := public.save_purchase_order(null, jsonb_build_object('supplier_id', s1, 'branch_id', br1, 'status', 'draft',
    'items', jsonb_build_array(jsonb_build_object('product_id', p1, 'qty', 10, 'unit_cost', 400))));
  reset role;
  select count(*) into n from public.purchase_orders where id = po and po_number = 'PO-000001' and total = 4000 and status = 'draft';
  report := report || case when n = 1 then '✅' else '❌' end || ' a draft order PO-000001 for 10 x 400 = 4000 is saved' || chr(10);

  perform set_config('request.jwt.claims', c_store, true);
  set local role authenticated;
  po := public.save_purchase_order(po, jsonb_build_object('supplier_id', s1, 'branch_id', br1, 'status', 'ordered',
    'items', jsonb_build_array(jsonb_build_object('product_id', p1, 'qty', 10, 'unit_cost', 400))));
  reset role;
  select count(*) into n from public.purchase_orders where id = po and status = 'ordered';
  select id into poi from public.purchase_order_items where po_id = po;
  report := report || case when n = 1 then '✅' else '❌' end || ' the order is marked as ordered' || chr(10);

  ---------------------------------------------------------------- RECEIVE PART OF IT (storekeeper)
  perform set_config('request.jwt.claims', c_store, true);
  set local role authenticated;
  res := public.receive_goods(jsonb_build_object('supplier_id', s1, 'branch_id', br1, 'po_id', po, 'supplier_invoice_no', 'INV-1',
    'client_uuid', '44444444-4444-4444-4444-444444444444',
    'items', jsonb_build_array(jsonb_build_object('product_id', p1, 'qty', 6, 'unit_cost', 420, 'po_item_id', poi))));
  reset role;
  select quantity into q from public.stock_levels where branch_id = br1 and product_id = p1;
  report := report || case when q = 6 and (res ->> 'total')::numeric = 2520 then '✅' else '❌' end || ' receiving 6 @ 420: stock 6, goods worth 2520 (stock ' || coalesce(q::text,'null') || ', total ' || coalesce(res ->> 'total','null') || ')' || chr(10);

  select cost_price into q from public.product_costs where product_id = p1;
  report := report || case when q = 420 then '✅' else '❌' end || ' the latest buying price became 420 (got ' || coalesce(q::text,'null') || ')' || chr(10);

  select balance into q from public.supplier_balances where supplier_id = s1;
  report := report || case when q = 2520 then '✅' else '❌' end || ' we owe the supplier 2520 (got ' || coalesce(q::text,'null') || ')' || chr(10);

  select count(*) into n from public.purchase_orders where id = po and status = 'partially_received';
  select qty_received into q from public.purchase_order_items where id = poi;
  report := report || case when n = 1 and q = 6 then '✅' else '❌' end || ' the order is "partially received" with 6 of 10 in' || chr(10);

  perform set_config('request.jwt.claims', c_store, true);
  set local role authenticated;
  res := public.receive_goods(jsonb_build_object('supplier_id', s1, 'branch_id', br1, 'po_id', po,
    'client_uuid', '44444444-4444-4444-4444-444444444444',
    'items', jsonb_build_array(jsonb_build_object('product_id', p1, 'qty', 6, 'unit_cost', 420, 'po_item_id', poi))));
  reset role;
  select quantity into q from public.stock_levels where branch_id = br1 and product_id = p1;
  report := report || case when q = 6 and (res ->> 'duplicate') = 'true' then '✅' else '❌' end || ' the same delivery sent twice is recorded once (stock ' || coalesce(q::text,'null') || ')' || chr(10);

  ---------------------------------------------------------------- who may do what
  perform set_config('request.jwt.claims', c_store, true);
  set local role authenticated;
  st := 'none';
  begin perform public.receive_goods(jsonb_build_object('supplier_id', s1, 'branch_id', br1,
      'items', jsonb_build_array(jsonb_build_object('product_id', p1, 'qty', 1, 'unit_cost', 400)),
      'payment', jsonb_build_object('method', 'cash', 'amount', 100)));
  exception when others then st := sqlstate; end;
  report := report || case when st = '42501' then '✅' else '❌' end || ' a storekeeper cannot record a payment to a supplier (sqlstate ' || st || ')' || chr(10);

  st := 'none';
  begin perform public.pay_supplier(jsonb_build_object('supplier_id', s1, 'amount', 50, 'method', 'cash'));
  exception when others then st := sqlstate; end;
  report := report || case when st = '42501' then '✅' else '❌' end || ' a storekeeper cannot pay suppliers (sqlstate ' || st || ')' || chr(10);

  st := 'none';
  begin perform public.adjust_supplier_balance(s1, 100, 'x', false);
  exception when others then st := sqlstate; end;
  report := report || case when st = '42501' then '✅' else '❌' end || ' a storekeeper cannot change a supplier balance (sqlstate ' || st || ')' || chr(10);

  st := 'none';
  begin insert into public.goods_receipts (branch_id, supplier_id, total) values (br1, s1, 99999);
  exception when others then st := sqlstate; end;
  report := report || case when st = '42501' then '✅' else '❌' end || ' deliveries cannot be made up by hand (sqlstate ' || st || ')' || chr(10);
  reset role;

  perform set_config('request.jwt.claims', c_cash, true);
  set local role authenticated;
  st := 'none';
  begin perform public.receive_goods(jsonb_build_object('supplier_id', s1, 'branch_id', br1,
      'items', jsonb_build_array(jsonb_build_object('product_id', p1, 'qty', 1, 'unit_cost', 400))));
  exception when others then st := sqlstate; end;
  select count(*) into n from public.supplier_ledger;
  q := n;
  select count(*) into n from public.suppliers;
  reset role;
  report := report || case when st = '42501' and q = 0 and n = 0 then '✅' else '❌' end || ' a cashier cannot receive goods and cannot see suppliers or what is owed (sqlstate ' || st || ', ledger rows ' || q || ', suppliers ' || n || ')' || chr(10);

  ---------------------------------------------------------------- OWNER: pay, receive the rest with a part payment
  perform set_config('request.jwt.claims', c_owner, true);
  set local role authenticated;
  res := public.pay_supplier(jsonb_build_object('supplier_id', s1, 'branch_id', br1, 'amount', 1000, 'method', 'cash', 'client_uuid', '55555555-5555-5555-5555-555555555555'));
  report := report || case when (res ->> 'balance_after')::numeric = 1520 then '✅' else '❌' end || ' paying the supplier 1000 leaves 1520 (got ' || coalesce(res ->> 'balance_after','null') || ')' || chr(10);

  res := public.pay_supplier(jsonb_build_object('supplier_id', s1, 'branch_id', br1, 'amount', 1000, 'method', 'cash', 'client_uuid', '55555555-5555-5555-5555-555555555555'));
  select balance into q from public.supplier_balances where supplier_id = s1;
  report := report || case when q = 1520 and (res ->> 'duplicate') = 'true' then '✅' else '❌' end || ' the same payment sent twice is recorded once (owes ' || coalesce(q::text,'null') || ')' || chr(10);

  st := 'none';
  begin perform public.receive_goods(jsonb_build_object('supplier_id', s1, 'branch_id', br1,
      'items', jsonb_build_array(jsonb_build_object('product_id', p1, 'qty', 1, 'unit_cost', 400)),
      'payment', jsonb_build_object('method', 'cash', 'amount', 5000)));
  exception when others then st := sqlstate; end;
  report := report || case when st = '22023' then '✅' else '❌' end || ' a payment bigger than the goods total is refused (sqlstate ' || st || ')' || chr(10);

  res := public.receive_goods(jsonb_build_object('supplier_id', s1, 'branch_id', br1, 'po_id', po,
    'items', jsonb_build_array(jsonb_build_object('product_id', p1, 'qty', 4, 'unit_cost', 400, 'po_item_id', poi)),
    'payment', jsonb_build_object('method', 'cash', 'amount', 600)));
  reset role;
  select balance into q from public.supplier_balances where supplier_id = s1;
  select quantity into q2 from public.stock_levels where branch_id = br1 and product_id = p1;
  report := report || case when q = 2520 and q2 = 10 then '✅' else '❌' end || ' last 4 @ 400 = 1600 with 600 paid: owe 2520, stock 10 (owe ' || coalesce(q::text,'null') || ', stock ' || coalesce(q2::text,'null') || ')' || chr(10);

  select count(*) into n from public.purchase_orders where id = po and status = 'received';
  select cost_price into q from public.product_costs where product_id = p1;
  report := report || case when n = 1 and q = 400 then '✅' else '❌' end || ' the order is "received" and the buying price is now 400' || chr(10);

  perform set_config('request.jwt.claims', c_owner, true);
  set local role authenticated;
  st := 'none';
  begin perform public.cancel_purchase_order(po);
  exception when others then st := sqlstate; end;
  reset role;
  report := report || case when st = 'P0001' then '✅' else '❌' end || ' a received order cannot be cancelled (sqlstate ' || st || ')' || chr(10);

  ---------------------------------------------------------------- return goods, old debt
  perform set_config('request.jwt.claims', c_store, true);
  set local role authenticated;
  res := public.return_to_supplier(jsonb_build_object('supplier_id', s1, 'branch_id', br1, 'reason', 'Wrong model',
    'items', jsonb_build_array(jsonb_build_object('product_id', p1, 'qty', 2, 'unit_cost', 400))));
  reset role;
  select quantity into q from public.stock_levels where branch_id = br1 and product_id = p1;
  report := report || case when q = 8 and (res ->> 'balance_after')::numeric = 1720 then '✅' else '❌' end || ' returning 2 @ 400: stock 8, we now owe 1720 (stock ' || coalesce(q::text,'null') || ', owe ' || coalesce(res ->> 'balance_after','null') || ')' || chr(10);

  perform set_config('request.jwt.claims', c_owner, true);
  set local role authenticated;
  q := public.adjust_supplier_balance(s1, 500, 'Old debt from the notebook', true);
  report := report || case when q = 2220 then '✅' else '❌' end || ' old debt of 500 added: we owe 2220 (got ' || coalesce(q::text,'null') || ')' || chr(10);

  st := 'none';
  begin perform public.adjust_supplier_balance(s1, -100, '', false);
  exception when others then st := sqlstate; end;
  report := report || case when st = '22023' then '✅' else '❌' end || ' a correction needs a reason (sqlstate ' || st || ')' || chr(10);

  ---------------------------------------------------------------- lists and history (owner)
  select count(*) into n from public.purchase_prices where product_id = p1;
  report := report || case when n = 2 then '✅' else '❌' end || ' buying price history has the 2 deliveries (got ' || n || ')' || chr(10);

  j := public.suppliers_summary();
  report := report || case when (j ->> 'total_owed')::numeric = 2220 and (j ->> 'owed_count')::int = 1 then '✅' else '❌' end || ' summary: we owe suppliers 2220 (got ' || j::text || ')' || chr(10);
  reset role;

  select count(*) into n from public.audit_logs where tenant_id = t and action = 'supplier_opening_balance';
  report := report || case when n = 1 then '✅' else '❌' end || ' the old debt entry is in the audit log' || chr(10);

  raise exception E'\n\n===== PHASE 6b TEST REPORT =====\n%\nThis "error" is expected: it rolls back all fake test data.\n', report;
end
$test$;
