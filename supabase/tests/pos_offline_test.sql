-- =====================================================================
-- Phase 5b TEST: sales made offline and sent later.
-- Paste the whole file in the Supabase SQL Editor and click Run.
-- It ends with an ERROR on purpose: the error text is the report and it
-- rolls back all fake data. Every line should start with a tick.
-- =====================================================================
do $test$
declare
  report text := '';
  st text; n bigint; q numeric; res jsonb; sid uuid;
  t   uuid := gen_random_uuid();
  uo  uuid := gen_random_uuid();
  uc  uuid := gen_random_uuid();   -- cashier, max discount 5
  br1 uuid := gen_random_uuid();
  p1 uuid; plan_id uuid; c1 uuid := gen_random_uuid();
  old_time text := to_char((now() - interval '2 hours') at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
  c_owner text; c_cash text;
begin
  insert into auth.users (id, email) values (uo, 'off-owner@test.local'), (uc, 'off-cash@test.local');
  insert into public.plans (code, name) values ('zz-off', 'Offline test plan') returning id into plan_id;
  insert into public.tenants (id, name, slug) values (t, 'Offline Test Shop', 'offline-test-shop');
  insert into public.subscriptions (tenant_id, plan_id, status) values (t, plan_id, 'active');
  insert into public.branches (id, tenant_id, name, code) values (br1, t, 'Main', 'OFF');
  insert into public.tenant_members (tenant_id, user_id, role, all_branches, max_discount_pct) values
    (t, uo, 'owner', true, 100), (t, uc, 'cashier', true, 5);
  insert into public.products (tenant_id, sku, name, selling_price) values (t, 'O1', 'Offline Part', 1000) returning id into p1;
  insert into public.product_costs (tenant_id, product_id, cost_price, min_selling_price) values (t, p1, 600, 800);
  insert into public.customers (id, tenant_id, name, credit_limit) values (c1, t, 'No Credit Customer', 0);

  c_owner := json_build_object('sub', uo, 'role', 'authenticated', 'tenant_id', t, 'tenant_role', 'owner', 'all_branches', true, 'branch_ids', json_build_array(), 'max_discount_pct', 100)::text;
  c_cash  := json_build_object('sub', uc, 'role', 'authenticated', 'tenant_id', t, 'tenant_role', 'cashier', 'all_branches', true, 'branch_ids', json_build_array(), 'max_discount_pct', 5)::text;

  perform set_config('request.jwt.claims', c_cash, true);
  set local role authenticated;

  -- 1. an offline sale that breaks three rules is still recorded, but flagged
  res := public.complete_sale(jsonb_build_object('client_uuid', gen_random_uuid(), 'branch_id', br1,
    'offline', true, 'sold_at', old_time, 'receipt_no', 'OFF-D4F2-0007', 'customer_id', c1,
    'items', jsonb_build_array(jsonb_build_object('product_id', p1, 'qty', 1, 'unit_price', 700)),
    'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 300))));
  sid := (res ->> 'sale_id')::uuid;
  reset role;
  select count(*) into n from public.sales where id = sid and is_offline and receipt_no = 'OFF-D4F2-0007'
     and array_length(offline_flags, 1) >= 3;
  report := report || case when n = 1 then '✅' else '❌' end || ' offline sale accepted with its own receipt number and 3+ flags (flagged ' || coalesce((res ->> 'flagged'), '?') || ')' || chr(10);

  select count(*) into n from public.sales where id = sid and sold_at < now() - interval '1 hour';
  report := report || case when n = 1 then '✅' else '❌' end || ' the sale keeps its original time (2 hours ago)' || chr(10);

  -- 2. the same rules online are still strict
  perform set_config('request.jwt.claims', c_cash, true);
  set local role authenticated;
  st := 'none';
  begin perform public.complete_sale(jsonb_build_object('branch_id', br1,
      'items', jsonb_build_array(jsonb_build_object('product_id', p1, 'qty', 1, 'unit_price', 700)),
      'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 700)));
  exception when others then st := sqlstate; end;
  report := report || case when st = 'P0001' then '✅' else '❌' end || ' the same sale made online is refused (sqlstate ' || st || ')' || chr(10);

  -- 3. a cashier cannot just claim "offline" to skip the rules
  st := 'none';
  begin perform public.complete_sale(jsonb_build_object('branch_id', br1, 'offline', true,
      'items', jsonb_build_array(jsonb_build_object('product_id', p1, 'qty', 1, 'unit_price', 700)),
      'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 700)));
  exception when others then st := sqlstate; end;
  report := report || case when st = 'P0001' then '✅' else '❌' end || ' "offline" with a current time does not skip the rules (sqlstate ' || st || ')' || chr(10);

  -- 4. same sale sent again (retry) is recorded once
  res := public.complete_sale(jsonb_build_object('client_uuid', '22222222-2222-2222-2222-222222222222', 'branch_id', br1,
    'offline', true, 'sold_at', old_time, 'receipt_no', 'OFF-D4F2-0008',
    'items', jsonb_build_array(jsonb_build_object('product_id', p1, 'qty', 1)),
    'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 1000))));
  res := public.complete_sale(jsonb_build_object('client_uuid', '22222222-2222-2222-2222-222222222222', 'branch_id', br1,
    'offline', true, 'sold_at', old_time, 'receipt_no', 'OFF-D4F2-0008',
    'items', jsonb_build_array(jsonb_build_object('product_id', p1, 'qty', 1)),
    'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 1000))));
  reset role;
  select count(*) into n from public.sales where client_uuid = '22222222-2222-2222-2222-222222222222';
  select -sum(quantity) into q from public.stock_movements where tenant_id = t and movement_type = 'sale' and product_id = p1;
  report := report || case when n = 1 and q = 2 and (res ->> 'duplicate') = 'true' then '✅' else '❌' end || ' a retried offline sale is recorded once (sales ' || n || ', stock sold ' || coalesce(q::text,'null') || ' = 2 expected)' || chr(10);

  -- 5. two devices using the same receipt number: the second gets a server number
  perform set_config('request.jwt.claims', c_cash, true);
  set local role authenticated;
  res := public.complete_sale(jsonb_build_object('client_uuid', gen_random_uuid(), 'branch_id', br1,
    'offline', true, 'sold_at', old_time, 'receipt_no', 'OFF-D4F2-0008',
    'items', jsonb_build_array(jsonb_build_object('product_id', p1, 'qty', 1)),
    'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 1000))));
  reset role;
  report := report || case when (res ->> 'receipt_no') <> 'OFF-D4F2-0008' and (res ->> 'receipt_no') like 'OFF-%' then '✅' else '❌' end || ' a clashing receipt number is replaced by a server number (' || (res ->> 'receipt_no') || ')' || chr(10);

  -- 6. review
  perform set_config('request.jwt.claims', c_cash, true);
  set local role authenticated;
  st := 'none';
  begin perform public.mark_sale_reviewed(sid);
  exception when others then st := sqlstate; end;
  reset role;
  report := report || case when st = '42501' then '✅' else '❌' end || ' a cashier cannot mark a sale as reviewed (sqlstate ' || st || ')' || chr(10);

  perform set_config('request.jwt.claims', c_owner, true);
  set local role authenticated;
  perform public.mark_sale_reviewed(sid);
  reset role;
  select count(*) into n from public.sales where id = sid and reviewed_at is not null and reviewed_by = uo;
  report := report || case when n = 1 then '✅' else '❌' end || ' the owner can mark a flagged sale as reviewed' || chr(10);

  raise exception E'\n\n===== PHASE 5b TEST REPORT =====\n%\nThis "error" is expected: it rolls back all fake test data.\n', report;
end
$test$;
