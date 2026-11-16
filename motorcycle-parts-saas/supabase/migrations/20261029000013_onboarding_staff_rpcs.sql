-- =====================================================================
-- Phase 3 / 13 — Onboarding & staff management functions (called by the app)
--   create_business()  : a signed-in user creates their shop (becomes owner)
--   invite_staff()     : owner creates an invite link for a staff member
--   accept_invite()    : the invited person joins using the link
--   update_staff()     : owner changes role / status / branches / discount limit
-- plus a plan limit on the number of branches.
-- =====================================================================

create or replace function private.slugify(p text)
returns text language sql immutable
as $$ select trim(both '-' from regexp_replace(lower(coalesce(p, '')), '[^a-z0-9]+', '-', 'g')) $$;

-- ---------------------------------------------------------------------
-- Branch limit per plan
-- ---------------------------------------------------------------------
create or replace function private.enforce_branch_limit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_max int; v_count int;
begin
  select p.max_branches into v_max
    from public.subscriptions s join public.plans p on p.id = s.plan_id
   where s.tenant_id = new.tenant_id;

  if v_max is not null then
    select count(*) into v_count from public.branches b
     where b.tenant_id = new.tenant_id and b.is_active;
    if v_count >= v_max then
      raise exception 'Your plan allows % branch(es). Please upgrade to add more.', v_max;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_branch_limit on public.branches;
create trigger trg_branch_limit before insert on public.branches
  for each row execute function private.enforce_branch_limit();

-- ---------------------------------------------------------------------
-- create_business
-- ---------------------------------------------------------------------
create or replace function public.create_business(
  p_name        text,
  p_branch_name text,
  p_branch_code text,
  p_phone       text default null
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_tenant uuid;
  v_plan   uuid;
  v_base   text;
  v_slug   text;
  v_code   text;
begin
  if v_uid is null then
    raise exception 'Please sign in first' using errcode = '42501';
  end if;

  p_name := btrim(coalesce(p_name, ''));
  p_branch_name := btrim(coalesce(p_branch_name, ''));
  v_code := upper(regexp_replace(coalesce(p_branch_code, ''), '[^A-Za-z0-9]', '', 'g'));

  if length(p_name) < 2 then
    raise exception 'Please enter your business name' using errcode = '22023';
  end if;
  if length(p_branch_name) < 2 then
    raise exception 'Please enter a branch name' using errcode = '22023';
  end if;
  if length(v_code) < 2 or length(v_code) > 6 then
    raise exception 'Branch code must be 2 to 6 letters or numbers (example: NRB)' using errcode = '22023';
  end if;

  if (select count(*) from public.tenant_members
       where user_id = v_uid and role = 'owner') >= 3 then
    raise exception 'You can own at most 3 businesses' using errcode = '22023';
  end if;

  select id into v_plan from public.plans where code = 'starter' and is_active;
  if v_plan is null then
    raise exception 'The Starter plan is missing. Run seed.sql first.' using errcode = 'P0002';
  end if;

  -- unique, URL-friendly name
  v_base := left(private.slugify(p_name), 30);
  if length(v_base) < 3 then v_base := 'shop'; end if;
  v_slug := v_base;
  while exists (select 1 from public.tenants where slug = v_slug) loop
    v_slug := v_base || '-' || substr(md5(random()::text), 1, 4);
  end loop;

  insert into public.tenants (name, slug, phone)
  values (p_name, v_slug, nullif(btrim(coalesce(p_phone, '')), ''))
  returning id into v_tenant;

  -- 14-day free trial on the Starter plan
  insert into public.subscriptions
    (tenant_id, plan_id, status, trial_ends_at, current_period_start, current_period_end)
  values (v_tenant, v_plan, 'trialing', now() + interval '14 days', now(), now() + interval '14 days');

  insert into public.branches (tenant_id, name, code)
  values (v_tenant, p_branch_name, v_code);

  insert into public.tenant_members (tenant_id, user_id, role, all_branches, max_discount_pct)
  values (v_tenant, v_uid, 'owner', true, 100);

  -- starter part categories and expense categories
  insert into public.product_categories (tenant_id, name, sort_order)
  select v_tenant, c.name, c.ord
    from unnest(array['Engine Parts','Brakes','Chain & Sprockets','Tyres & Tubes',
                      'Electricals & Lighting','Batteries','Filters','Oils & Lubricants',
                      'Cables & Controls','Suspension','Body & Accessories','Bolts, Nuts & Misc'])
         with ordinality as c(name, ord);

  insert into public.expense_categories (tenant_id, name)
  select v_tenant, n
    from unnest(array['Rent','Electricity & Water','Transport','Salaries',
                      'Airtime & Internet','Licences & Permits','Repairs & Maintenance','Other']) as n;

  -- make this the user's active business (the app then refreshes the session)
  update auth.users
     set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
                             || jsonb_build_object('active_tenant_id', v_tenant)
   where id = v_uid;

  return v_tenant;
end $$;

-- ---------------------------------------------------------------------
-- invite_staff : returns the secret token used in the invite link
--   p_branch_ids empty  => the person can work in ALL branches
-- ---------------------------------------------------------------------
create or replace function public.invite_staff(
  p_email      text,
  p_role       public.app_role,
  p_branch_ids uuid[] default '{}'
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_tenant uuid := private.tenant_id();
  v_email  text := lower(btrim(coalesce(p_email, '')));
  v_max    int;
  v_count  int;
  v_token  uuid;
begin
  if v_tenant is null or not private.has_role(array['owner']) then
    raise exception 'Only the business owner can invite staff' using errcode = '42501';
  end if;
  if not private.tenant_writable() then
    raise exception 'Your subscription is not active' using errcode = '42501';
  end if;
  if p_role = 'owner' then
    raise exception 'You cannot invite another owner. Invite as manager, then promote them.' using errcode = '22023';
  end if;
  if position('@' in v_email) < 2 then
    raise exception 'Please enter a valid email address' using errcode = '22023';
  end if;

  -- every branch must belong to this business
  if exists (
    select 1 from unnest(coalesce(p_branch_ids, '{}')) as x(id)
     where not exists (select 1 from public.branches b where b.id = x.id and b.tenant_id = v_tenant)
  ) then
    raise exception 'Unknown branch selected' using errcode = '22023';
  end if;

  -- plan limit on staff (active members + other pending invites)
  select p.max_users into v_max
    from public.subscriptions s join public.plans p on p.id = s.plan_id
   where s.tenant_id = v_tenant;
  if v_max is not null then
    select (select count(*) from public.tenant_members m
             where m.tenant_id = v_tenant and m.status = 'active')
         + (select count(*) from public.tenant_invites i
             where i.tenant_id = v_tenant and i.accepted_at is null
               and i.expires_at > now() and lower(i.email) <> v_email)
      into v_count;
    if v_count >= v_max then
      raise exception 'Your plan allows % staff accounts. Please upgrade to add more.', v_max;
    end if;
  end if;

  -- a new invite replaces any earlier unused invite for the same email
  delete from public.tenant_invites
   where tenant_id = v_tenant and lower(email) = v_email and accepted_at is null;

  insert into public.tenant_invites (tenant_id, email, role, branch_ids, invited_by)
  values (v_tenant, v_email, p_role, coalesce(p_branch_ids, '{}'), auth.uid())
  returning token into v_token;

  return v_token;
end $$;

-- ---------------------------------------------------------------------
-- accept_invite : the signed-in person must use the SAME email the invite was sent to
-- ---------------------------------------------------------------------
create or replace function public.accept_invite(p_token uuid)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_email  text;
  inv      public.tenant_invites;
  v_max    int;
  v_count  int;
  v_member uuid;
begin
  if v_uid is null then
    raise exception 'Please sign in first' using errcode = '42501';
  end if;

  select lower(u.email) into v_email from auth.users u where u.id = v_uid;

  select * into inv from public.tenant_invites where token = p_token for update;
  if inv.id is null or inv.accepted_at is not null or inv.expires_at < now() then
    raise exception 'This invite is invalid or has expired' using errcode = '22023';
  end if;
  if lower(inv.email) <> v_email then
    raise exception 'This invite was sent to a different email address' using errcode = '42501';
  end if;

  select p.max_users into v_max
    from public.subscriptions s join public.plans p on p.id = s.plan_id
   where s.tenant_id = inv.tenant_id;
  if v_max is not null then
    select count(*) into v_count from public.tenant_members m
     where m.tenant_id = inv.tenant_id and m.status = 'active' and m.user_id <> v_uid;
    if v_count >= v_max then
      raise exception 'This business has reached its staff limit' using errcode = '22023';
    end if;
  end if;

  insert into public.tenant_members (tenant_id, user_id, role, all_branches, max_discount_pct)
  values (inv.tenant_id, v_uid, inv.role, cardinality(inv.branch_ids) = 0,
          case inv.role when 'manager' then 20 when 'cashier' then 5 else 0 end)
  on conflict (tenant_id, user_id) do update
     set role = excluded.role, status = 'active', all_branches = excluded.all_branches
  returning id into v_member;

  delete from public.member_branches where member_id = v_member;
  insert into public.member_branches (tenant_id, member_id, branch_id)
  select inv.tenant_id, v_member, b.id
    from public.branches b
   where b.tenant_id = inv.tenant_id and b.id = any (inv.branch_ids);

  update public.tenant_invites set accepted_at = now() where id = inv.id;

  update auth.users
     set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
                             || jsonb_build_object('active_tenant_id', inv.tenant_id)
   where id = v_uid;

  return inv.tenant_id;
end $$;

-- ---------------------------------------------------------------------
-- update_staff : owner only. NULL arguments mean "leave unchanged".
--   p_branch_ids: NULL = unchanged, empty array = all branches, list = only those
-- ---------------------------------------------------------------------
create or replace function public.update_staff(
  p_member_id        uuid,
  p_role             public.app_role default null,
  p_status           public.member_status default null,
  p_branch_ids       uuid[] default null,
  p_max_discount_pct numeric default null
) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_tenant uuid := private.tenant_id();
  m        public.tenant_members;
  v_other_owners int;
begin
  if v_tenant is null or not private.has_role(array['owner']) then
    raise exception 'Only the business owner can change staff' using errcode = '42501';
  end if;
  if not private.tenant_writable() then
    raise exception 'Your subscription is not active' using errcode = '42501';
  end if;

  select * into m from public.tenant_members
   where id = p_member_id and tenant_id = v_tenant for update;
  if m.id is null then
    raise exception 'Staff member not found' using errcode = 'P0002';
  end if;

  -- never leave a business without an active owner
  if m.role = 'owner'
     and ((p_role is not null and p_role <> 'owner') or p_status = 'disabled') then
    select count(*) into v_other_owners from public.tenant_members x
     where x.tenant_id = v_tenant and x.role = 'owner' and x.status = 'active' and x.id <> m.id;
    if v_other_owners = 0 then
      raise exception 'A business must keep at least one active owner';
    end if;
  end if;

  update public.tenant_members
     set role             = coalesce(p_role, role),
         status           = coalesce(p_status, status),
         max_discount_pct = coalesce(p_max_discount_pct, max_discount_pct),
         all_branches     = case when p_branch_ids is null then all_branches
                                 else cardinality(p_branch_ids) = 0 end
   where id = m.id;

  if p_branch_ids is not null then
    delete from public.member_branches where member_id = m.id;
    insert into public.member_branches (tenant_id, member_id, branch_id)
    select v_tenant, m.id, b.id
      from public.branches b
     where b.tenant_id = v_tenant and b.id = any (p_branch_ids);
  end if;
end $$;

-- Only signed-in users may call these (never anonymous visitors)
revoke execute on function public.create_business(text, text, text, text) from public, anon;
revoke execute on function public.invite_staff(text, public.app_role, uuid[]) from public, anon;
revoke execute on function public.accept_invite(uuid) from public, anon;
revoke execute on function public.update_staff(uuid, public.app_role, public.member_status, uuid[], numeric) from public, anon;
grant execute on function public.create_business(text, text, text, text) to authenticated;
grant execute on function public.invite_staff(text, public.app_role, uuid[]) to authenticated;
grant execute on function public.accept_invite(uuid) to authenticated;
grant execute on function public.update_staff(uuid, public.app_role, public.member_status, uuid[], numeric) to authenticated;
