-- =====================================================================
-- Phase 2 TEST: proves tenants cannot see or change each other's data.
--
-- HOW TO RUN: paste this whole file into the Supabase SQL Editor and click Run.
-- It ends with an ERROR on purpose: the error message IS the test report,
-- and the error also rolls back all the fake test data automatically.
-- Every line should start with a green tick. A red cross means a problem.
-- =====================================================================
do $test$
declare
  report text := '';
  st text;
  n bigint;
  q numeric;
  txt text;
  -- fixed ids for the fake data
  ua uuid := '00000000-0000-0000-0000-0000000000a1';  -- owner of shop A
  uc uuid := '00000000-0000-0000-0000-0000000000a2';  -- cashier of shop A (branch A1 only)
  ub uuid := '00000000-0000-0000-0000-0000000000b1';  -- owner of shop B
  ta uuid := '00000000-0000-0000-0000-00000000aa01';
  tb uuid := '00000000-0000-0000-0000-00000000bb01';
  a1 uuid := '00000000-0000-0000-0000-0000000a0001';
  a2 uuid := '00000000-0000-0000-0000-0000000a0002';
  b1 uuid := '00000000-0000-0000-0000-0000000b0001';
  pa1 uuid := '00000000-0000-0000-0000-000000fa0001';
  pa2 uuid := '00000000-0000-0000-0000-000000fa0002';
  pb1 uuid := '00000000-0000-0000-0000-000000fb0001';
  bb  uuid := '00000000-0000-0000-0000-000000bb0001';  -- a brand belonging to shop B
  c1  uuid := '00000000-0000-0000-0000-0000000c0001';
  s4  uuid := '00000000-0000-0000-0000-0000000e0004';
  plan_id uuid;
  claims_owner_a text;
  claims_cashier_a text;
begin
  ---------------------------------------------------------------- SETUP (as admin)
  insert into auth.users (id, email) values
    (ua, 'owner-a@test.local'), (uc, 'cashier-a@test.local'), (ub, 'owner-b@test.local');

  insert into public.plans (code, name) values ('zz-test', 'Test plan') returning id into plan_id;
  insert into public.tenants (id, name, slug) values
    (ta, 'Test Shop A', 'test-shop-a'), (tb, 'Test Shop B', 'test-shop-b');
  insert into public.subscriptions (tenant_id, plan_id, status) values
    (ta, plan_id, 'active'), (tb, plan_id, 'active');

  insert into public.branches (id, tenant_id, name, code) values
    (a1, ta, 'A Branch 1', 'NRB'), (a2, ta, 'A Branch 2', 'MSA'), (b1, tb, 'B Branch 1', 'KSM');

  insert into public.tenant_members (id, tenant_id, user_id, role, all_branches) values
    (gen_random_uuid(), ta, ua, 'owner', true),
    (gen_random_uuid(), ta, uc, 'cashier', false),
    (gen_random_uuid(), tb, ub, 'owner', true);
  insert into public.member_branches (tenant_id, member_id, branch_id)
    select ta, id, a1 from public.tenant_members where user_id = uc;

  insert into public.brands (id, tenant_id, name) values (bb, tb, 'B Brand');
  insert into public.products (id, tenant_id, sku, name, selling_price) values
    (pa1, ta, 'A1', 'A Product 1', 100), (pa2, ta, 'A2', 'A Product 2', 200),
    (pb1, tb, 'B1', 'B Product', 300);

  insert into public.customers (id, tenant_id, name) values (c1, ta, 'Test Customer');

  -- three plain sales: one by the cashier (branch A1), two by the owner (A1 and A2)
  insert into public.sales (tenant_id, branch_id, receipt_no, cashier_id, status) values
    (ta, a1, 'T-1', uc, 'completed'),
    (ta, a1, 'T-2', ua, 'completed'),
    (ta, a2, 'T-3', ua, 'completed');

  claims_owner_a := json_build_object('sub', ua, 'role', 'authenticated', 'tenant_id', ta,
    'tenant_role', 'owner', 'all_branches', true, 'branch_ids', json_build_array())::text;
  claims_cashier_a := json_build_object('sub', uc, 'role', 'authenticated', 'tenant_id', ta,
    'tenant_role', 'cashier', 'all_branches', false, 'branch_ids', json_build_array(a1))::text;

  ---------------------------------------------------------------- AUTOMATION (as admin)
  select count(*) into n from public.profiles where id in (ua, uc, ub);
  report := report || case when n = 3 then '✅' else '❌' end || ' new users get a profile automatically (got ' || n || ')' || chr(10);

  insert into public.stock_movements (tenant_id, branch_id, product_id, movement_type, quantity)
    values (ta, a1, pa1, 'purchase', 10);
  insert into public.stock_movements (tenant_id, branch_id, product_id, movement_type, quantity)
    values (ta, a1, pa1, 'sale', -3);
  select quantity into q from public.stock_levels where branch_id = a1 and product_id = pa1;
  report := report || case when q = 7 then '✅' else '❌' end || ' stock: +10 then -3 leaves 7 (got ' || coalesce(q::text,'null') || ')' || chr(10);

  insert into public.sales (id, tenant_id, branch_id, receipt_no, customer_id, cashier_id, status, total)
    values (s4, ta, a1, 'T-4', c1, ua, 'completed', 1000);
  insert into public.payments (tenant_id, branch_id, kind, sale_id, customer_id, method, amount, received_by)
    values (ta, a1, 'sale_payment', s4, c1, 'cash', 400, ua);
  select balance into q from public.customer_balances where customer_id = c1;
  report := report || case when q = 600 then '✅' else '❌' end || ' credit sale 1000 - payment 400 = customer owes 600 (got ' || coalesce(q::text,'null') || ')' || chr(10);
  select amount_paid into q from public.sales where id = s4;
  report := report || case when q = 400 then '✅' else '❌' end || ' sale amount_paid updated to 400 (got ' || coalesce(q::text,'null') || ')' || chr(10);

  select count(*) into n from public.audit_logs where table_name = 'stock_movements';
  report := report || case when n = 0 then '✅' else '❌' end || ' normal sales are NOT audit-logged, only adjustments (got ' || n || ')' || chr(10);

  -- a shop can never point at another shop's data (composite foreign keys)
  st := 'none';
  begin
    insert into public.products (tenant_id, sku, name, brand_id) values (ta, 'BAD', 'Bad', bb);
  exception when others then st := sqlstate; end;
  report := report || case when st = '23503' then '✅' else '❌' end || ' shop A cannot link a product to shop B''s brand (sqlstate ' || st || ')' || chr(10);

  ---------------------------------------------------------------- OWNER OF SHOP A
  perform set_config('request.jwt.claims', claims_owner_a, true);
  set local role authenticated;

  select count(*) into n from public.products;
  report := report || case when n = 2 then '✅' else '❌' end || ' owner A sees only shop A products (got ' || n || ', expected 2)' || chr(10);

  select count(*) into n from public.products where id = pb1;
  report := report || case when n = 0 then '✅' else '❌' end || ' owner A cannot see shop B''s product by id' || chr(10);

  select count(*) into n from public.tenants;
  report := report || case when n = 1 then '✅' else '❌' end || ' owner A sees only their own business record (got ' || n || ')' || chr(10);

  st := 'none';
  begin
    insert into public.products (tenant_id, sku, name) values (tb, 'HACK', 'Hack');
  exception when others then st := sqlstate; end;
  report := report || case when st = '42501' then '✅' else '❌' end || ' owner A cannot insert a product into shop B (sqlstate ' || st || ')' || chr(10);

  update public.products set name = 'HACKED' where id = pb1;      -- should touch 0 rows
  insert into public.products (sku, name, selling_price) values ('A-NEW', 'New product', 50);  -- tenant_id filled automatically
  select count(*) into n from public.products;
  report := report || case when n = 3 then '✅' else '❌' end || ' tenant_id fills in automatically on insert (shop A now has ' || n || ')' || chr(10);

  select count(*) into n from public.sales;
  report := report || case when n = 4 then '✅' else '❌' end || ' owner A sees all 4 sales across both branches (got ' || n || ')' || chr(10);

  select public.next_document_number('receipt', a1) into txt;
  report := report || case when txt = 'NRB-000001' then '✅' else '❌' end || ' first receipt number is NRB-000001 (got ' || coalesce(txt,'null') || ')' || chr(10);
  select public.next_document_number('receipt', a1) into txt;
  report := report || case when txt = 'NRB-000002' then '✅' else '❌' end || ' second receipt number is NRB-000002 (got ' || coalesce(txt,'null') || ')' || chr(10);

  st := 'none';
  begin
    perform public.next_document_number('receipt', b1);          -- a branch of shop B
  exception when others then st := sqlstate; end;
  report := report || case when st in ('42501','23503') then '✅' else '❌' end || ' owner A cannot number documents for shop B''s branch (sqlstate ' || st || ')' || chr(10);

  reset role;
  select name into txt from public.products where id = pb1;
  report := report || case when txt = 'B Product' then '✅' else '❌' end || ' shop B''s product was NOT changed by owner A (name is ' || coalesce(txt,'null') || ')' || chr(10);

  ---------------------------------------------------------------- CASHIER OF SHOP A (branch A1 only)
  perform set_config('request.jwt.claims', claims_cashier_a, true);
  set local role authenticated;

  st := 'none';
  begin
    insert into public.products (sku, name) values ('C-HACK', 'Cashier product');
  exception when others then st := sqlstate; end;
  report := report || case when st = '42501' then '✅' else '❌' end || ' cashier cannot create products (sqlstate ' || st || ')' || chr(10);

  select count(*) into n from public.sales;
  report := report || case when n = 1 then '✅' else '❌' end || ' cashier sees only their own sale (got ' || n || ', expected 1)' || chr(10);

  st := 'none';
  begin
    insert into public.sales (branch_id, receipt_no, cashier_id, status) values (a2, 'C-9', uc, 'completed');
  exception when others then st := sqlstate; end;
  report := report || case when st = '42501' then '✅' else '❌' end || ' cashier cannot sell in a branch they are not assigned to (sqlstate ' || st || ')' || chr(10);

  st := 'none';
  begin
    insert into public.sales (branch_id, receipt_no, cashier_id, status) values (a1, 'C-OK', uc, 'completed');
  exception when others then st := sqlstate; end;
  report := report || case when st = '42501' then '✅' else '❌' end || ' cashier cannot insert sales directly, sales go through the till (sqlstate ' || st || ')' || chr(10);

  select count(*) into n from public.tenant_members;
  report := report || case when n = 1 then '✅' else '❌' end || ' cashier sees only their own staff record (got ' || n || ')' || chr(10);

  select count(*) into n from public.audit_logs;
  report := report || case when n = 0 then '✅' else '❌' end || ' cashier cannot read the audit log (got ' || n || ' rows)' || chr(10);

  reset role;

  ---------------------------------------------------------------- SUSPENDED SHOP
  update public.subscriptions set status = 'suspended' where tenant_id = ta;
  perform set_config('request.jwt.claims', claims_owner_a, true);
  set local role authenticated;

  st := 'none';
  begin
    insert into public.products (sku, name) values ('SUSP', 'Should fail');
  exception when others then st := sqlstate; end;
  report := report || case when st = '42501' then '✅' else '❌' end || ' suspended shop cannot add data (sqlstate ' || st || ')' || chr(10);

  select count(*) into n from public.products;
  report := report || case when n = 3 then '✅' else '❌' end || ' suspended shop can still READ its data (got ' || n || ')' || chr(10);
  reset role;

  ---------------------------------------------------------------- REPORT
  raise exception E'\n\n===== PHASE 2 TEST REPORT =====\n%\nThis "error" is expected: it rolls back all fake test data.\n', report;
end
$test$;
