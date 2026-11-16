-- =====================================================================
-- Phase 4b TEST: transfers between branches, spreadsheet import, plan limit.
-- Paste the whole file in the Supabase SQL Editor and click Run.
-- It ends with an ERROR on purpose: the error text is the report and it
-- rolls back all fake data. Every line should start with a tick.
-- =====================================================================
do $test$
declare
  report text := '';
  st text; n bigint; q numeric; txt text;
  pid uuid; tid uuid; tid2 uuid; tid3 uuid; item uuid; res jsonb;
  t       uuid := gen_random_uuid();
  uo      uuid := gen_random_uuid();   -- owner
  u1      uuid := gen_random_uuid();   -- storekeeper, branch 1 only
  u2      uuid := gen_random_uuid();   -- storekeeper, branch 2 only
  br1     uuid := gen_random_uuid();
  br2     uuid := gen_random_uuid();
  plan_id uuid; make_id uuid; model_id uuid;
  c_owner text; c_s1 text; c_s2 text;
begin
  ---------------------------------------------------------------- SETUP
  insert into auth.users (id, email) values (uo, 'tr-owner@test.local'), (u1, 'tr-s1@test.local'), (u2, 'tr-s2@test.local');
  insert into public.plans (code, name) values ('zz-tr', 'Transfer test plan') returning id into plan_id;
  insert into public.tenants (id, name, slug) values (t, 'Transfer Test Shop', 'transfer-test-shop');
  insert into public.subscriptions (tenant_id, plan_id, status) values (t, plan_id, 'active');
  insert into public.branches (id, tenant_id, name, code) values (br1, t, 'Main', 'MAI'), (br2, t, 'Second', 'SEC');
  insert into public.tenant_members (tenant_id, user_id, role, all_branches) values
    (t, uo, 'owner', true), (t, u1, 'storekeeper', false), (t, u2, 'storekeeper', false);
  insert into public.member_branches (tenant_id, member_id, branch_id)
    select t, id, br1 from public.tenant_members where user_id = u1;
  insert into public.member_branches (tenant_id, member_id, branch_id)
    select t, id, br2 from public.tenant_members where user_id = u2;
  insert into public.bike_makes (tenant_id, name) values (null, 'ZZ Import Make') returning id into make_id;
  insert into public.bike_models (tenant_id, make_id, name, engine_cc) values (null, make_id, 'ZZ Import Model', 100) returning id into model_id;

  c_owner := json_build_object('sub', uo, 'role', 'authenticated', 'tenant_id', t, 'tenant_role', 'owner',
     'all_branches', true, 'branch_ids', json_build_array())::text;
  c_s1 := json_build_object('sub', u1, 'role', 'authenticated', 'tenant_id', t, 'tenant_role', 'storekeeper',
     'all_branches', false, 'branch_ids', json_build_array(br1))::text;
  c_s2 := json_build_object('sub', u2, 'role', 'authenticated', 'tenant_id', t, 'tenant_role', 'storekeeper',
     'all_branches', false, 'branch_ids', json_build_array(br2))::text;

  ---------------------------------------------------------------- TRANSFERS
  perform set_config('request.jwt.claims', c_owner, true);
  set local role authenticated;

  select public.save_product(null, jsonb_build_object('name', 'Transfer Part', 'sku', 'TR-1', 'selling_price', 100,
     'opening_branch_id', br1, 'opening_qty', 10)) into pid;
  select public.send_transfer(br1, br2, jsonb_build_array(jsonb_build_object('product_id', pid, 'qty', 4)), 'test') into tid;
  reset role;

  select quantity into q from public.stock_levels where branch_id = br1 and product_id = pid;
  report := report || case when tid is not null and q = 6 then '✅' else '❌' end || ' sending 4 takes them out of the sending branch (left ' || coalesce(q::text,'null') || ')' || chr(10);
  select count(*) into n from public.stock_transfers where id = tid and status = 'in_transit' and transfer_no like 'TR-%';
  report := report || case when n = 1 then '✅' else '❌' end || ' the transfer is "in transit" with a TR- number' || chr(10);

  perform set_config('request.jwt.claims', c_owner, true);
  set local role authenticated;
  st := 'none';
  begin perform public.send_transfer(br1, br2, jsonb_build_array(jsonb_build_object('product_id', pid, 'qty', 50)));
  exception when others then st := sqlstate; end;
  report := report || case when st = '22023' then '✅' else '❌' end || ' cannot send more than the branch has (sqlstate ' || st || ')' || chr(10);

  st := 'none';
  begin perform public.send_transfer(br1, br1, jsonb_build_array(jsonb_build_object('product_id', pid, 'qty', 1)));
  exception when others then st := sqlstate; end;
  report := report || case when st = '22023' then '✅' else '❌' end || ' cannot send to the same branch (sqlstate ' || st || ')' || chr(10);

  st := 'none';
  begin insert into public.stock_transfers (transfer_no, from_branch_id, to_branch_id, status) values ('FAKE-1', br1, br2, 'received');
  exception when others then st := sqlstate; end;
  report := report || case when st = '42501' then '✅' else '❌' end || ' transfers cannot be made up by hand (sqlstate ' || st || ')' || chr(10);
  reset role;

  perform set_config('request.jwt.claims', c_s2, true);
  set local role authenticated;
  st := 'none';
  begin perform public.send_transfer(br1, br2, jsonb_build_array(jsonb_build_object('product_id', pid, 'qty', 1)));
  exception when others then st := sqlstate; end;
  reset role;
  report := report || case when st = '42501' then '✅' else '❌' end || ' staff of branch 2 cannot send stock from branch 1 (sqlstate ' || st || ')' || chr(10);

  perform set_config('request.jwt.claims', c_s1, true);
  set local role authenticated;
  st := 'none';
  begin perform public.receive_transfer(tid);
  exception when others then st := sqlstate; end;
  reset role;
  report := report || case when st = '42501' then '✅' else '❌' end || ' staff of branch 1 cannot receive for branch 2 (sqlstate ' || st || ')' || chr(10);

  perform set_config('request.jwt.claims', c_s2, true);
  set local role authenticated;
  perform public.receive_transfer(tid);
  reset role;
  select quantity into q from public.stock_levels where branch_id = br2 and product_id = pid;
  report := report || case when q = 4 then '✅' else '❌' end || ' receiving adds 4 at the receiving branch (got ' || coalesce(q::text,'null') || ')' || chr(10);

  perform set_config('request.jwt.claims', c_s2, true);
  set local role authenticated;
  st := 'none';
  begin perform public.receive_transfer(tid);
  exception when others then st := sqlstate; end;
  reset role;
  report := report || case when st = 'P0001' then '✅' else '❌' end || ' a transfer cannot be received twice (sqlstate ' || st || ')' || chr(10);

  -- short delivery: send 3, receive 2
  perform set_config('request.jwt.claims', c_owner, true);
  set local role authenticated;
  select public.send_transfer(br1, br2, jsonb_build_array(jsonb_build_object('product_id', pid, 'qty', 3))) into tid2;
  reset role;
  select id into item from public.stock_transfer_items where transfer_id = tid2;
  perform set_config('request.jwt.claims', c_s2, true);
  set local role authenticated;
  perform public.receive_transfer(tid2, jsonb_build_array(jsonb_build_object('item_id', item, 'qty', 2)));
  reset role;
  select quantity into q from public.stock_levels where branch_id = br2 and product_id = pid;
  report := report || case when q = 6 then '✅' else '❌' end || ' short delivery: 4 + 2 received = 6 at branch 2 (got ' || coalesce(q::text,'null') || ')' || chr(10);
  select count(*) into n from public.stock_movements where reference_id = tid2 and movement_type = 'damage' and quantity = -1;
  report := report || case when n = 1 then '✅' else '❌' end || ' the missing item is recorded as lost' || chr(10);

  -- cancel: send 2 then cancel (branch 1 had 10 - 4 - 3 = 3)
  perform set_config('request.jwt.claims', c_owner, true);
  set local role authenticated;
  select public.send_transfer(br1, br2, jsonb_build_array(jsonb_build_object('product_id', pid, 'qty', 2))) into tid3;
  perform public.cancel_transfer(tid3);
  reset role;
  select quantity into q from public.stock_levels where branch_id = br1 and product_id = pid;
  report := report || case when q = 3 then '✅' else '❌' end || ' cancelling puts the stock back (branch 1 has ' || coalesce(q::text,'null') || ', expected 3)' || chr(10);

  ---------------------------------------------------------------- IMPORT
  perform set_config('request.jwt.claims', c_owner, true);
  set local role authenticated;

  res := public.import_products(jsonb_build_array(
    jsonb_build_object('_row', 2, 'sku', 'IMP-1', 'name', 'Chain Set TVS', 'category', 'Chain & Sprockets', 'brand', 'RK',
      'quality', 'genuine', 'selling_price', '2500', 'cost_price', '1800', 'opening_stock', '5',
      'fits', 'ZZ Import Model', 'barcode', '111222333'),
    jsonb_build_object('_row', 3, 'sku', 'IMP-2', 'name', 'Spark Plug', 'selling_price', '300', 'cost_price', '150', 'fits', 'No Such Bike'),
    jsonb_build_object('_row', 4, 'sku', 'IMP-1', 'name', 'Chain Set TVS Updated', 'selling_price', '2600'),
    jsonb_build_object('_row', 5, 'name', '', 'selling_price', '1'),
    jsonb_build_object('_row', 6, 'sku', 'IMP-3', 'name', 'No price item')
  ), br1, false);
  report := report || case when (res ->> 'created')::int = 2 and (res ->> 'skipped')::int = 1 and (res ->> 'failed')::int = 2
                      then '✅' else '❌' end || ' import: 2 created, 1 skipped (duplicate), 2 failed (got created ' || (res ->> 'created') || ', skipped ' || (res ->> 'skipped') || ', failed ' || (res ->> 'failed') || ')' || chr(10);

  select count(*) into n from public.product_categories where name = 'Chain & Sprockets';
  report := report || case when n = 1 then '✅' else '❌' end || ' a new category was created from the file' || chr(10);
  select count(*) into n from public.brands where name = 'RK';
  report := report || case when n = 1 then '✅' else '❌' end || ' a new brand was created from the file' || chr(10);

  select sl.quantity into q from public.stock_levels sl join public.products p on p.id = sl.product_id where p.sku = 'IMP-1' and sl.branch_id = br1;
  report := report || case when q = 5 then '✅' else '❌' end || ' opening stock 5 was recorded (got ' || coalesce(q::text,'null') || ')' || chr(10);

  select count(*) into n from public.product_overview where sku = 'IMP-1' and array_length(bike_model_ids, 1) = 1 and barcodes @> array['111222333'];
  report := report || case when n = 1 then '✅' else '❌' end || ' bike fit and barcode were saved from the file' || chr(10);

  report := report || case when (res -> 'warnings')::text like '%No Such Bike%' then '✅' else '❌' end || ' an unknown bike gives a warning, not a failure' || chr(10);

  -- update existing: blank cells must keep their old values
  res := public.import_products(jsonb_build_array(
    jsonb_build_object('_row', 2, 'sku', 'IMP-1', 'name', 'Chain Set TVS Updated', 'selling_price', '2600')
  ), br1, true);
  report := report || case when (res ->> 'updated')::int = 1 then '✅' else '❌' end || ' import can update an existing product' || chr(10);

  select count(*) into n from public.products p
    join public.product_costs c on c.product_id = p.id
    join public.product_overview o on o.id = p.id
   where p.sku = 'IMP-1' and p.selling_price = 2600 and c.cost_price = 1800
     and p.category_id is not null and p.brand_id is not null
     and array_length(o.bike_model_ids, 1) = 1 and o.barcodes @> array['111222333'] and o.stock_qty = 5;
  report := report || case when n = 1 then '✅' else '❌' end || ' update changed the price but kept cost, category, brand, bike fit, barcode and stock' || chr(10);
  reset role;

  ---------------------------------------------------------------- PLAN LIMIT
  update public.plans set max_products = 2 where id = plan_id;   -- the shop already has 3 products

  perform set_config('request.jwt.claims', c_owner, true);
  set local role authenticated;
  st := 'none';
  begin perform public.save_product(null, jsonb_build_object('name', 'One too many', 'selling_price', 10));
  exception when others then st := sqlstate; end;
  report := report || case when st = 'P0001' then '✅' else '❌' end || ' adding a product beyond the plan limit is refused (sqlstate ' || st || ')' || chr(10);

  res := public.import_products(jsonb_build_array(
    jsonb_build_object('_row', 2, 'sku', 'IMP-9', 'name', 'Over the limit', 'selling_price', '50')
  ), br1, false);
  report := report || case when (res ->> 'failed')::int = 1 and (res -> 'errors')::text like '%plan allows%' then '✅' else '❌' end || ' import also respects the plan limit' || chr(10);
  reset role;

  raise exception E'\n\n===== PHASE 4b TEST REPORT =====\n%\nThis "error" is expected: it rolls back all fake test data.\n', report;
end
$test$;
