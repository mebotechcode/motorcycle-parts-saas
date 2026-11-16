-- =====================================================================
-- Phase 3 TEST: creating a shop, inviting staff, accepting invites.
-- Paste the whole file in the Supabase SQL Editor and click Run.
-- It ends with an ERROR on purpose: the error text is the report and it
-- rolls back all fake data. Every line should start with a tick.
-- (Needs seed.sql to have been run, because it uses the Starter plan.)
-- =====================================================================
do $test$
declare
  report text := '';
  st text; txt text; n bigint;
  t uuid; tok uuid; owner_member uuid; cashier_member uuid; t_back uuid;
  u1 uuid := '00000000-0000-0000-0000-0000000000c1';  -- will create the shop
  u2 uuid := '00000000-0000-0000-0000-0000000000c2';  -- invited cashier
  u3 uuid := '00000000-0000-0000-0000-0000000000c3';  -- stranger
  c_u1 text; c_owner text; c_u2 text; c_cashier text; c_u3 text;
begin
  insert into auth.users (id, email) values
    (u1, 'boss@test.local'), (u2, 'invitee@test.local'), (u3, 'stranger@test.local');

  c_u1 := json_build_object('sub', u1, 'role', 'authenticated')::text;
  c_u2 := json_build_object('sub', u2, 'role', 'authenticated')::text;
  c_u3 := json_build_object('sub', u3, 'role', 'authenticated')::text;

  ------------------------------------------------------------ create business
  perform set_config('request.jwt.claims', c_u1, true);
  set local role authenticated;
  select public.create_business('Test Parts Ltd', 'Main Shop', 'nrb', '0700000000') into t;
  reset role;
  report := report || case when t is not null then '✅' else '❌' end || ' create_business returns a business id' || chr(10);

  select count(*) into n from public.tenant_members where tenant_id = t and user_id = u1 and role = 'owner';
  report := report || case when n = 1 then '✅' else '❌' end || ' creator became the owner' || chr(10);

  select count(*) into n from public.subscriptions where tenant_id = t and status = 'trialing';
  report := report || case when n = 1 then '✅' else '❌' end || ' 14-day trial subscription created' || chr(10);

  select code into txt from public.branches where tenant_id = t;
  report := report || case when txt = 'NRB' then '✅' else '❌' end || ' first branch created with code NRB (got ' || coalesce(txt,'null') || ')' || chr(10);

  select count(*) into n from public.product_categories where tenant_id = t;
  report := report || case when n >= 8 then '✅' else '❌' end || ' starter product categories added (got ' || n || ')' || chr(10);

  -- the login hook must put the right claims into the token
  select (public.custom_access_token_hook(jsonb_build_object('user_id', u1,
            'claims', jsonb_build_object('app_metadata', jsonb_build_object('active_tenant_id', t)))) -> 'claims' ->> 'tenant_role') into txt;
  report := report || case when txt = 'owner' then '✅' else '❌' end || ' login hook adds tenant_role = owner (got ' || coalesce(txt,'null') || ')' || chr(10);

  c_owner := json_build_object('sub', u1, 'role', 'authenticated', 'tenant_id', t,
     'tenant_role', 'owner', 'all_branches', true, 'branch_ids', json_build_array())::text;

  ------------------------------------------------------------ plan limits & invites
  perform set_config('request.jwt.claims', c_owner, true);
  set local role authenticated;

  st := 'none';
  begin
    insert into public.branches (name, code) values ('Second', 'MSA');
  exception when others then st := sqlstate; end;
  report := report || case when st = 'P0001' then '✅' else '❌' end || ' Starter plan blocks a 2nd branch (sqlstate ' || st || ')' || chr(10);

  st := 'none';
  begin
    perform public.invite_staff('x@test.local', 'owner', '{}');
  exception when others then st := sqlstate; end;
  report := report || case when st = '22023' then '✅' else '❌' end || ' cannot invite someone directly as owner (sqlstate ' || st || ')' || chr(10);

  select public.invite_staff('Invitee@Test.local', 'cashier', '{}') into tok;
  reset role;
  report := report || case when tok is not null then '✅' else '❌' end || ' owner can create an invite' || chr(10);

  ------------------------------------------------------------ accepting
  perform set_config('request.jwt.claims', c_u3, true);
  set local role authenticated;
  st := 'none';
  begin
    perform public.accept_invite(tok);
  exception when others then st := sqlstate; end;
  reset role;
  report := report || case when st = '42501' then '✅' else '❌' end || ' a stranger with a different email cannot use the invite (sqlstate ' || st || ')' || chr(10);

  perform set_config('request.jwt.claims', c_u2, true);
  set local role authenticated;
  select public.accept_invite(tok) into t_back;
  reset role;
  report := report || case when t_back = t then '✅' else '❌' end || ' the invited person joins the right business' || chr(10);

  select count(*) into n from public.tenant_members where tenant_id = t and user_id = u2 and role = 'cashier' and all_branches;
  report := report || case when n = 1 then '✅' else '❌' end || ' they are a cashier with access to all branches' || chr(10);

  select count(*) into n from public.tenant_invites where token = tok and accepted_at is not null;
  report := report || case when n = 1 then '✅' else '❌' end || ' the invite is marked as used' || chr(10);

  perform set_config('request.jwt.claims', c_u2, true);
  set local role authenticated;
  st := 'none';
  begin
    perform public.accept_invite(tok);
  exception when others then st := sqlstate; end;
  reset role;
  report := report || case when st = '22023' then '✅' else '❌' end || ' an invite cannot be used twice (sqlstate ' || st || ')' || chr(10);

  ------------------------------------------------------------ cashier powers
  c_cashier := json_build_object('sub', u2, 'role', 'authenticated', 'tenant_id', t,
     'tenant_role', 'cashier', 'all_branches', true, 'branch_ids', json_build_array())::text;
  perform set_config('request.jwt.claims', c_cashier, true);
  set local role authenticated;
  st := 'none';
  begin
    perform public.invite_staff('another@test.local', 'cashier', '{}');
  exception when others then st := sqlstate; end;
  reset role;
  report := report || case when st = '42501' then '✅' else '❌' end || ' a cashier cannot invite staff (sqlstate ' || st || ')' || chr(10);

  ------------------------------------------------------------ managing staff
  select id into owner_member   from public.tenant_members where tenant_id = t and user_id = u1;
  select id into cashier_member from public.tenant_members where tenant_id = t and user_id = u2;

  perform set_config('request.jwt.claims', c_owner, true);
  set local role authenticated;

  st := 'none';
  begin
    perform public.update_staff(owner_member, 'cashier');
  exception when others then st := sqlstate; end;
  report := report || case when st = 'P0001' then '✅' else '❌' end || ' the only owner cannot be demoted (sqlstate ' || st || ')' || chr(10);

  perform public.update_staff(cashier_member, 'manager', null, null, 25);
  reset role;
  select count(*) into n from public.tenant_members where id = cashier_member and role = 'manager' and max_discount_pct = 25;
  report := report || case when n = 1 then '✅' else '❌' end || ' owner can promote staff and set a discount limit' || chr(10);

  select count(*) into n from public.audit_logs where tenant_id = t and table_name = 'tenant_members';
  report := report || case when n >= 3 then '✅' else '❌' end || ' staff changes are recorded in the audit log (got ' || n || ' entries)' || chr(10);

  raise exception E'\n\n===== PHASE 3 TEST REPORT =====\n%\nThis "error" is expected: it rolls back all fake test data.\n', report;
end
$test$;
