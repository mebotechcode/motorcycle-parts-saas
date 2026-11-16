-- =====================================================================
-- Phase 6a TEST: customers on credit, repayments, write-offs.
-- Paste the whole file in the Supabase SQL Editor and click Run.
-- It ends with an ERROR on purpose: the error text is the report and it
-- rolls back all fake data. Every line should start with a tick.
-- =====================================================================
do $test$
declare
  report text := '';
  st text; n bigint; q numeric; q2 numeric; res jsonb; s1 uuid; s2 uuid; s3 uuid; s4 uuid; j jsonb;
  t   uuid := gen_random_uuid();
  uo  uuid := gen_random_uuid();
  um  uuid := gen_random_uuid();
  uc  uuid := gen_random_uuid();
  br1 uuid := gen_random_uuid();
  p1 uuid; plan_id uuid; c1 uuid := gen_random_uuid();
  c_owner text; c_mgr text; c_cash text;
begin
  ---------------------------------------------------------------- SETUP
  insert into auth.users (id, email) values (uo, 'cu-owner@test.local'), (um, 'cu-mgr@test.local'), (uc, 'cu-cash@test.local');
  insert into public.plans (code, name, features) values ('zz-cu', 'Customers test plan', '{"sms": true}') returning id into plan_id;
  insert into public.tenants (id, name, slug) values (t, 'Customers Test Shop', 'customers-test-shop');
  insert into public.subscriptions (tenant_id, plan_id, status) values (t, plan_id, 'active');
  insert into public.branches (id, tenant_id, name, code) values (br1, t, 'Main', 'CUS');
  insert into public.tenant_members (tenant_id, user_id, role, all_branches, max_discount_pct) values
    (t, uo, 'owner', true, 100), (t, um, 'manager', true, 20), (t, uc, 'cashier', true, 5);
  insert into public.products (tenant_id, sku, name, selling_price) values (t, 'C1', 'Credit Part', 1000) returning id into p1;
  insert into public.customers (id, tenant_id, name, phone, credit_limit) values (c1, t, 'Credit Customer', '0712345678', 10000);

  c_owner := json_build_object('sub', uo, 'role', 'authenticated', 'tenant_id', t, 'tenant_role', 'owner', 'all_branches', true, 'branch_ids', json_build_array(), 'max_discount_pct', 100)::text;
  c_mgr   := json_build_object('sub', um, 'role', 'authenticated', 'tenant_id', t, 'tenant_role', 'manager', 'all_branches', true, 'branch_ids', json_build_array(), 'max_discount_pct', 20)::text;
  c_cash  := json_build_object('sub', uc, 'role', 'authenticated', 'tenant_id', t, 'tenant_role', 'cashier', 'all_branches', true, 'branch_ids', json_build_array(), 'max_discount_pct', 5)::text;

  ---------------------------------------------------------------- two credit sales: 1000 (10 days ago) and 960
  perform set_config('request.jwt.claims', c_cash, true);
  set local role authenticated;
  res := public.complete_sale(jsonb_build_object('branch_id', br1, 'customer_id', c1,
    'sold_at', to_char((now() - interval '10 days') at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'items', jsonb_build_array(jsonb_build_object('product_id', p1, 'qty', 1)), 'payments', '[]'::jsonb));
  s1 := (res ->> 'sale_id')::uuid;
  res := public.complete_sale(jsonb_build_object('branch_id', br1, 'customer_id', c1,
    'items', jsonb_build_array(jsonb_build_object('product_id', p1, 'qty', 1, 'unit_price', 960)), 'payments', '[]'::jsonb));
  s2 := (res ->> 'sale_id')::uuid;
  reset role;
  select balance into q from public.customer_balances where customer_id = c1;
  report := report || case when q = 1960 then '✅' else '❌' end || ' two credit sales: customer owes 1960 (got ' || coalesce(q::text,'null') || ')' || chr(10);

  ---------------------------------------------------------------- repayment: oldest sale first
  perform set_config('request.jwt.claims', c_cash, true);
  set local role authenticated;
  res := public.record_customer_payment(jsonb_build_object('customer_id', c1, 'branch_id', br1, 'amount', 1200,
    'method', 'cash', 'client_uuid', '33333333-3333-3333-3333-333333333333'));
  reset role;
  select amount_paid into q from public.sales where id = s1;
  select amount_paid into q2 from public.sales where id = s2;
  report := report || case when q = 1000 and q2 = 200 then '✅' else '❌' end || ' 1200 paid: oldest sale cleared (1000), next gets 200 (got ' || coalesce(q::text,'null') || ' and ' || coalesce(q2::text,'null') || ')' || chr(10);
  report := report || case when (res ->> 'balance_after')::numeric = 760 and (res ->> 'extra')::numeric = 0 then '✅' else '❌' end || ' the customer now owes 760 (got ' || coalesce(res ->> 'balance_after', 'null') || ')' || chr(10);

  -- the same payment sent twice
  perform set_config('request.jwt.claims', c_cash, true);
  set local role authenticated;
  res := public.record_customer_payment(jsonb_build_object('customer_id', c1, 'branch_id', br1, 'amount', 1200,
    'method', 'cash', 'client_uuid', '33333333-3333-3333-3333-333333333333'));
  reset role;
  select balance into q from public.customer_balances where customer_id = c1;
  report := report || case when q = 760 and (res ->> 'duplicate') = 'true' then '✅' else '❌' end || ' paying the same thing twice is recorded once (owes ' || coalesce(q::text,'null') || ')' || chr(10);

  -- paying more than owed: the extra becomes credit on the account
  perform set_config('request.jwt.claims', c_cash, true);
  set local role authenticated;
  res := public.record_customer_payment(jsonb_build_object('customer_id', c1, 'branch_id', br1, 'amount', 1000, 'method', 'cash'));
  reset role;
  select balance into q from public.customer_balances where customer_id = c1;
  report := report || case when q = -240 and (res ->> 'extra')::numeric = 240 then '✅' else '❌' end || ' paying 1000 when 760 is owed leaves 240 as credit (balance ' || coalesce(q::text,'null') || ')' || chr(10);

  ---------------------------------------------------------------- M-Pesa split over two sales
  perform set_config('request.jwt.claims', c_cash, true);
  set local role authenticated;
  res := public.complete_sale(jsonb_build_object('branch_id', br1, 'customer_id', c1,
    'items', jsonb_build_array(jsonb_build_object('product_id', p1, 'qty', 1)), 'payments', '[]'::jsonb));
  s3 := (res ->> 'sale_id')::uuid;
  res := public.complete_sale(jsonb_build_object('branch_id', br1, 'customer_id', c1,
    'items', jsonb_build_array(jsonb_build_object('product_id', p1, 'qty', 1)), 'payments', '[]'::jsonb));
  s4 := (res ->> 'sale_id')::uuid;
  res := public.record_customer_payment(jsonb_build_object('customer_id', c1, 'branch_id', br1, 'amount', 1500,
    'method', 'mpesa', 'reference', 'mpe1234567'));
  j := res;
  reset role;
  select count(*) into n from public.payments where customer_id = c1 and reference = 'MPE1234567';
  select count(*) into q from public.payments where group_id = (j ->> 'group_id')::uuid;
  report := report || case when n = 1 and q = 2 then '✅' else '❌' end || ' M-Pesa 1500 over two sales: 2 parts, the code on one only (code on ' || n || ', parts ' || q || ')' || chr(10);

  perform set_config('request.jwt.claims', c_cash, true);
  set local role authenticated;
  st := 'none';
  begin perform public.record_customer_payment(jsonb_build_object('customer_id', c1, 'branch_id', br1, 'amount', 10, 'method', 'mpesa', 'reference', 'MPE1234567'));
  exception when others then st := sqlstate; end;
  report := report || case when st = '23505' then '✅' else '❌' end || ' the same M-Pesa code cannot be used again (sqlstate ' || st || ')' || chr(10);

  st := 'none';
  begin perform public.record_customer_payment(jsonb_build_object('customer_id', c1, 'branch_id', br1, 'amount', 10, 'method', 'mpesa'));
  exception when others then st := sqlstate; end;
  report := report || case when st = '22023' then '✅' else '❌' end || ' an M-Pesa payment needs a code (sqlstate ' || st || ')' || chr(10);

  ---------------------------------------------------------------- cashier limits
  st := 'none';
  begin perform public.add_opening_balance(c1, 500, 'notebook');
  exception when others then st := sqlstate; end;
  report := report || case when st = '42501' then '✅' else '❌' end || ' a cashier cannot add an opening balance (sqlstate ' || st || ')' || chr(10);

  st := 'none';
  begin perform public.adjust_customer_balance(c1, -100, 'write off');
  exception when others then st := sqlstate; end;
  report := report || case when st = '42501' then '✅' else '❌' end || ' a cashier cannot write off debt (sqlstate ' || st || ')' || chr(10);

  st := 'none';
  begin update public.customers set credit_limit = 99999 where id = c1;
  exception when others then st := sqlstate; end;
  report := report || case when st = '42501' then '✅' else '❌' end || ' a cashier cannot raise a credit limit (sqlstate ' || st || ')' || chr(10);

  select (public.sms_allowed() ->> 'role_ok')::boolean into st from (select 1) x;
  report := report || case when st = 'false' then '✅' else '❌' end || ' a cashier may not send SMS reminders' || chr(10);
  reset role;

  ---------------------------------------------------------------- manager tools
  select balance into q from public.customer_balances where customer_id = c1;   -- 260 expected: -240 + 2000 - 1500

  perform set_config('request.jwt.claims', c_mgr, true);
  set local role authenticated;
  q2 := public.add_opening_balance(c1, 700, 'From the old notebook');
  report := report || case when q = 260 and q2 = 960 then '✅' else '❌' end || ' manager adds an opening balance of 700: 260 becomes 960 (before ' || coalesce(q::text,'null') || ', after ' || coalesce(q2::text,'null') || ')' || chr(10);

  st := 'none';
  begin perform public.adjust_customer_balance(c1, -300, '');
  exception when others then st := sqlstate; end;
  report := report || case when st = '22023' then '✅' else '❌' end || ' a write-off needs a reason (sqlstate ' || st || ')' || chr(10);

  q2 := public.adjust_customer_balance(c1, -300, 'Customer moved away');
  report := report || case when q2 = 660 then '✅' else '❌' end || ' writing off 300 leaves 660 (got ' || coalesce(q2::text,'null') || ')' || chr(10);

  select (public.sms_allowed() ->> 'plan_ok')::boolean into st from (select 1) x;
  report := report || case when st = 'true' then '✅' else '❌' end || ' SMS is allowed on this plan for a manager' || chr(10);
  reset role;

  select count(*) into n from public.audit_logs where tenant_id = t and action in ('opening_balance', 'debt_adjustment');
  report := report || case when n = 2 then '✅' else '❌' end || ' both changes are in the audit log (got ' || n || ')' || chr(10);

  ---------------------------------------------------------------- lists and numbers (owner)
  perform set_config('request.jwt.claims', c_owner, true);
  set local role authenticated;
  update public.customers set credit_limit = 100 where id = c1;

  select balance, (over_limit)::int, (oldest_unpaid_at is not null)::int
    into q, n, q2
    from public.customer_overview where id = c1;
  report := report || case when q = 660 and n = 1 and q2 = 1 then '✅' else '❌' end || ' customer list: owes 660, over the limit, has an oldest unpaid sale (balance ' || coalesce(q::text,'null') || ')' || chr(10);

  j := public.customers_summary();
  report := report || case when (j ->> 'owing_count')::int = 1 and (j ->> 'total_owed')::numeric = 660 and (j ->> 'over_limit_count')::int = 1
                      then '✅' else '❌' end || ' summary: 1 customer owes 660 and is over the limit (got ' || j::text || ')' || chr(10);
  reset role;

  raise exception E'\n\n===== PHASE 6a TEST REPORT =====\n%\nThis "error" is expected: it rolls back all fake test data.\n', report;
end
$test$;
