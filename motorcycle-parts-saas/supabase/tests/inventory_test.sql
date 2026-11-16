-- =====================================================================
-- Phase 4a TEST: products, hidden costs, stock rules.
-- Paste the whole file in the Supabase SQL Editor and click Run.
-- It ends with an ERROR on purpose: the error text is the report and it
-- rolls back all fake data. Every line should start with a tick.
-- =====================================================================
do $test$
declare
  report text := '';
  st text; n bigint; q numeric; b boolean;
  pid uuid; pid2 uuid;
  t       uuid := gen_random_uuid();
  uo      uuid := gen_random_uuid();
  uc      uuid := gen_random_uuid();
  br1     uuid := gen_random_uuid();
  br2     uuid := gen_random_uuid();
  plan_id uuid; make_id uuid; model_id uuid;
  c_owner text; c_cashier text;
begin
  ---------------------------------------------------------------- SETUP
  insert into auth.users (id, email) values (uo, 'inv-owner@test.local'), (uc, 'inv-cashier@test.local');
  insert into public.plans (code, name) values ('zz-inv', 'Inventory test plan') returning id into plan_id;
  insert into public.tenants (id, name, slug) values (t, 'Inventory Test Shop', 'inventory-test-shop');
  insert into public.subscriptions (tenant_id, plan_id, status) values (t, plan_id, 'active');
  insert into public.branches (id, tenant_id, name, code) values (br1, t, 'Main', 'MAI'), (br2, t, 'Second', 'SEC');
  insert into public.tenant_members (tenant_id, user_id, role, all_branches) values
    (t, uo, 'owner', true), (t, uc, 'cashier', true);
  insert into public.bike_makes (tenant_id, name) values (null, 'ZZ Test Make') returning id into make_id;
  insert into public.bike_models (tenant_id, make_id, name, engine_cc) values (null, make_id, 'ZZ Model 100', 100)
    returning id into model_id;

  c_owner := json_build_object('sub', uo, 'role', 'authenticated', 'tenant_id', t,
    'tenant_role', 'owner', 'all_branches', true, 'branch_ids', json_build_array())::text;
  c_cashier := json_build_object('sub', uc, 'role', 'authenticated', 'tenant_id', t,
    'tenant_role', 'cashier', 'all_branches', true, 'branch_ids', json_build_array())::text;

  ---------------------------------------------------------------- OWNER
  perform set_config('request.jwt.claims', c_owner, true);
  set local role authenticated;

  select public.save_product(null, jsonb_build_object(
    'name', 'Brake Pad Boxer', 'sku', 'BP-001', 'selling_price', 500, 'wholesale_price', 450,
    'cost_price', 300, 'min_selling_price', 420, 'reorder_level', 5,
    'barcodes', jsonb_build_array('6001234567890'),
    'bike_model_ids', jsonb_build_array(model_id),
    'opening_branch_id', br1, 'opening_qty', 12)) into pid;
  report := report || case when pid is not null then '✅' else '❌' end || ' owner can create a product' || chr(10);

  select stock_qty, is_low into q, b from public.product_overview where id = pid;
  report := report || case when q = 12 and b = false then '✅' else '❌' end || ' opening stock of 12 recorded, not low (got ' || coalesce(q::text,'null') || ')' || chr(10);

  select count(*) into n from public.product_overview where id = pid and bike_model_ids @> array[model_id] and barcodes @> array['6001234567890'];
  report := report || case when n = 1 then '✅' else '❌' end || ' bike fit and barcode saved' || chr(10);

  select cost_price into q from public.product_costs where product_id = pid;
  report := report || case when q = 300 then '✅' else '❌' end || ' owner can see the buying price (got ' || coalesce(q::text,'null') || ')' || chr(10);

  st := 'none';
  begin perform public.save_product(null, jsonb_build_object('name', 'Another', 'sku', 'BP-001', 'selling_price', 10));
  exception when others then st := sqlstate; end;
  report := report || case when st = '23505' then '✅' else '❌' end || ' duplicate product code is refused (sqlstate ' || st || ')' || chr(10);

  st := 'none';
  begin perform public.save_product(null, jsonb_build_object('name', 'Another', 'selling_price', 10, 'barcodes', jsonb_build_array('6001234567890')));
  exception when others then st := sqlstate; end;
  report := report || case when st = '23505' then '✅' else '❌' end || ' duplicate barcode is refused (sqlstate ' || st || ')' || chr(10);

  st := 'none';
  begin perform public.save_product(null, jsonb_build_object('name', 'Bad prices', 'selling_price', 100, 'min_selling_price', 150));
  exception when others then st := sqlstate; end;
  report := report || case when st = '22023' then '✅' else '❌' end || ' lowest price above selling price is refused (sqlstate ' || st || ')' || chr(10);

  select public.save_product(null, jsonb_build_object('name', 'Auto Code Item', 'selling_price', 80)) into pid2;
  select count(*) into n from public.products where id = pid2 and sku like 'P-%';
  report := report || case when n = 1 then '✅' else '❌' end || ' a product code is generated when left empty' || chr(10);

  perform public.save_product(pid, jsonb_build_object('name', 'Brake Pad Boxer', 'sku', 'BP-001', 'selling_price', 550,
    'wholesale_price', 450, 'cost_price', 300, 'min_selling_price', 420, 'reorder_level', 5));
  select selling_price into q from public.products where id = pid;
  report := report || case when q = 550 then '✅' else '❌' end || ' owner can edit a product (price now ' || coalesce(q::text,'null') || ')' || chr(10);

  -- stock rules
  st := 'none';
  begin insert into public.stock_movements (branch_id, product_id, movement_type, quantity, reason) values (br1, pid, 'purchase', 50, 'fake delivery');
  exception when others then st := sqlstate; end;
  report := report || case when st = '42501' then '✅' else '❌' end || ' staff cannot fake a purchase by hand (sqlstate ' || st || ')' || chr(10);

  st := 'none';
  begin insert into public.stock_movements (branch_id, product_id, movement_type, quantity) values (br1, pid, 'adjustment', -1);
  exception when others then st := sqlstate; end;
  report := report || case when st = '23514' then '✅' else '❌' end || ' an adjustment without a reason is refused (sqlstate ' || st || ')' || chr(10);

  st := 'none';
  begin insert into public.stock_movements (branch_id, product_id, movement_type, quantity, reason) values (br1, pid, 'damage', 3, 'wrong sign');
  exception when others then st := sqlstate; end;
  report := report || case when st = '23514' then '✅' else '❌' end || ' damaged stock must be a negative number (sqlstate ' || st || ')' || chr(10);

  insert into public.stock_movements (branch_id, product_id, movement_type, quantity, reason) values (br1, pid, 'damage', -3, 'Dropped and cracked');
  select quantity into q from public.stock_levels where branch_id = br1 and product_id = pid;
  report := report || case when q = 9 then '✅' else '❌' end || ' damaged -3 leaves 9 (got ' || coalesce(q::text,'null') || ')' || chr(10);

  insert into public.stock_movements (branch_id, product_id, movement_type, quantity, reason) values (br1, pid, 'adjustment', -5, 'Stock count');
  select is_low, stock_qty into b, q from public.product_overview where id = pid;
  report := report || case when b = true and q = 4 then '✅' else '❌' end || ' stock 4 is at/below reorder level 5, so it is flagged low' || chr(10);

  reset role;
  select count(*) into n from public.audit_logs where tenant_id = t and table_name = 'products';
  report := report || case when n >= 1 then '✅' else '❌' end || ' the price change was written to the audit log (got ' || n || ')' || chr(10);
  select count(*) into n from public.audit_logs where tenant_id = t and table_name = 'stock_movements';
  report := report || case when n = 2 then '✅' else '❌' end || ' the damage and the adjustment were audit-logged (got ' || n || ')' || chr(10);

  ---------------------------------------------------------------- CASHIER
  perform set_config('request.jwt.claims', c_cashier, true);
  set local role authenticated;

  select count(*) into n from public.product_costs;
  report := report || case when n = 0 then '✅' else '❌' end || ' cashier CANNOT see buying prices (saw ' || n || ' rows)' || chr(10);

  select count(*) into n from public.product_overview where id = pid;
  report := report || case when n = 1 then '✅' else '❌' end || ' cashier can see the product and its stock' || chr(10);

  st := 'none';
  begin perform public.save_product(null, jsonb_build_object('name', 'Cashier product', 'selling_price', 10));
  exception when others then st := sqlstate; end;
  report := report || case when st = '42501' then '✅' else '❌' end || ' cashier cannot create products (sqlstate ' || st || ')' || chr(10);

  st := 'none';
  begin insert into public.stock_movements (branch_id, product_id, movement_type, quantity, reason) values (br1, pid, 'adjustment', 100, 'free stock');
  exception when others then st := sqlstate; end;
  report := report || case when st = '42501' then '✅' else '❌' end || ' cashier cannot change stock (sqlstate ' || st || ')' || chr(10);
  reset role;

  raise exception E'\n\n===== PHASE 4a TEST REPORT =====\n%\nThis "error" is expected: it rolls back all fake test data.\n', report;
end
$test$;
