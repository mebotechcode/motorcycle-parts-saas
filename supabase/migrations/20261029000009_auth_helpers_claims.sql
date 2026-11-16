-- =====================================================================
-- Phase 2 / 09 — JWT claims hook + security helper functions
-- After this migration you must ENABLE the hook in the Supabase dashboard
-- (see PHASE2_SETUP.md): Authentication -> Hooks -> Custom Access Token
-- =====================================================================

-- "private" holds internal helpers. It is NOT exposed through the API.
create schema if not exists private;
grant usage on schema private to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 1. Custom Access Token hook: puts the user's business + role inside
--    their login token (JWT) so every security rule can read it quickly.
--    Claims added: tenant_id, tenant_role, all_branches, branch_ids,
--    max_discount_pct, platform_admin
-- ---------------------------------------------------------------------
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  claims jsonb := event -> 'claims';
  v_user uuid  := (event ->> 'user_id')::uuid;
  v_pref uuid  := nullif(claims -> 'app_metadata' ->> 'active_tenant_id', '')::uuid;
  m      record;
  v_branches jsonb;
begin
  -- the user's active membership: the business they picked, else their oldest one
  select tm.id, tm.tenant_id, tm.role, tm.all_branches, tm.max_discount_pct
    into m
    from public.tenant_members tm
   where tm.user_id = v_user
     and tm.status = 'active'
   order by (tm.tenant_id = v_pref) desc nulls last, tm.created_at
   limit 1;

  claims := claims || jsonb_build_object(
    'platform_admin',
    exists (select 1 from public.platform_admins pa where pa.user_id = v_user)
  );

  if m.id is not null then
    select coalesce(jsonb_agg(mb.branch_id), '[]'::jsonb)
      into v_branches
      from public.member_branches mb
     where mb.member_id = m.id;

    claims := claims || jsonb_build_object(
      'tenant_id',        m.tenant_id,
      'tenant_role',      m.role,
      'all_branches',     m.all_branches,
      'branch_ids',       v_branches,
      'max_discount_pct', m.max_discount_pct
    );
  end if;

  return jsonb_set(event, '{claims}', claims);
end $$;

-- Only Supabase Auth may run the hook
grant usage on schema public to supabase_auth_admin;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb) from authenticated, anon, public;

-- The hook runs as supabase_auth_admin, so it needs to read these tables
grant select on public.tenant_members, public.member_branches, public.platform_admins
  to supabase_auth_admin;

create policy auth_admin_read_members on public.tenant_members
  as permissive for select to supabase_auth_admin using (true);
create policy auth_admin_read_member_branches on public.member_branches
  as permissive for select to supabase_auth_admin using (true);
create policy auth_admin_read_platform_admins on public.platform_admins
  as permissive for select to supabase_auth_admin using (true);

-- ---------------------------------------------------------------------
-- 2. Switch the active business (for users who belong to several shops).
--    After calling this, the app must call supabase.auth.refreshSession().
-- ---------------------------------------------------------------------
create or replace function public.set_active_tenant(p_tenant_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.tenant_members
     where user_id = auth.uid() and tenant_id = p_tenant_id and status = 'active'
  ) then
    raise exception 'You are not an active member of that business' using errcode = '42501';
  end if;

  update auth.users
     set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
                             || jsonb_build_object('active_tenant_id', p_tenant_id)
   where id = auth.uid();
end $$;

revoke execute on function public.set_active_tenant(uuid) from public, anon;
grant  execute on function public.set_active_tenant(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 3. Helpers used by every security policy (read the JWT; no table lookups,
--    so they are fast). "stable" lets Postgres reuse results within a query.
-- ---------------------------------------------------------------------
create or replace function private.tenant_id()
returns uuid language sql stable
as $$ select nullif(auth.jwt() ->> 'tenant_id', '')::uuid $$;

create or replace function private.tenant_role()
returns text language sql stable
as $$ select auth.jwt() ->> 'tenant_role' $$;

create or replace function private.has_role(p_roles text[])
returns boolean language sql stable
as $$ select coalesce(private.tenant_role() = any (p_roles), false) $$;

-- true if the user may work in this branch (owner/manager usually have all_branches)
create or replace function private.can_access_branch(p_branch uuid)
returns boolean language sql stable
as $$
  select coalesce((auth.jwt() ->> 'all_branches')::boolean, false)
      or coalesce(jsonb_exists(auth.jwt() -> 'branch_ids', p_branch::text), false)
$$;

-- SaaS owner (you). Looks at the table, not the token, so removal is instant.
create or replace function private.is_platform_admin()
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.platform_admins where user_id = auth.uid()) $$;

-- Can this business WRITE data? Suspended / expired / unpaid-past-grace => read-only.
create or replace function private.tenant_writable()
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
      from public.tenants t
      join public.subscriptions s on s.tenant_id = t.id
     where t.id = private.tenant_id()
       and t.status = 'active'
       and s.status in ('trialing','active','past_due')
       and (s.status <> 'trialing' or s.trial_ends_at is null or s.trial_ends_at > now())
  )
$$;

grant execute on function
  private.tenant_id(), private.tenant_role(), private.has_role(text[]),
  private.can_access_branch(uuid), private.is_platform_admin(), private.tenant_writable()
  to authenticated;
