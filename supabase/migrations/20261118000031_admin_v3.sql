-- =====================================================================
-- Phase 9 / 31 — Super-admin v3: login activity (IP + device), active
-- sessions, global health, stamp IP/UA on admin_audit_log.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Client IP / user-agent as seen by PostgREST (admin RPC calls)
-- ---------------------------------------------------------------------
create or replace function private.client_ip()
returns text
language sql stable
as $$
  select nullif(btrim(split_part(coalesce(
    current_setting('request.headers', true)::json->>'x-forwarded-for',
    current_setting('request.headers', true)::json->>'x-real-ip',
    ''
  ), ',', 1)), '')
$$;

create or replace function private.client_ua()
returns text
language sql stable
as $$
  select left(nullif(current_setting('request.headers', true)::json->>'user-agent', ''), 300)
$$;

alter table public.admin_audit_log
  add column if not exists ip_address text,
  add column if not exists user_agent text;

create or replace function private.admin_audit_stamp()
returns trigger
language plpgsql
as $$
begin
  if new.ip_address is null then new.ip_address := private.client_ip(); end if;
  if new.user_agent is null then new.user_agent := private.client_ua(); end if;
  return new;
end $$;

drop trigger if exists trg_admin_audit_stamp on public.admin_audit_log;
create trigger trg_admin_audit_stamp
  before insert on public.admin_audit_log
  for each row execute function private.admin_audit_stamp();

-- ---------------------------------------------------------------------
-- 2. Login history — one row per new auth session (IP + user-agent)
--    GoTrue already stores these on auth.sessions; we copy them so the
--    log survives logout / session deletion.
-- ---------------------------------------------------------------------
create table if not exists public.login_activity (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null,
  event      text not null default 'login',
  ip_address text,
  user_agent text,
  created_at timestamptz not null default now()
);
create index if not exists login_activity_created_idx on public.login_activity (created_at desc);
create index if not exists login_activity_user_idx on public.login_activity (user_id, created_at desc);
create index if not exists login_activity_ip_idx on public.login_activity (ip_address);

alter table public.login_activity enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'login_activity'
       and policyname = 'login_activity_admin_read'
  ) then
    create policy login_activity_admin_read on public.login_activity
      for select to authenticated using ((select private.is_platform_admin()));
  end if;
end $$;

grant select on public.login_activity to authenticated;
grant all on public.login_activity to service_role;

create or replace function private.capture_session_login()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.login_activity (user_id, event, ip_address, user_agent, created_at)
  values (
    new.user_id,
    'login',
    case when new.ip is null then null else host(new.ip) end,
    left(new.user_agent, 300),
    coalesce(new.created_at, now())
  );
  return new;
end $$;

drop trigger if exists trg_capture_session_login on auth.sessions;
create trigger trg_capture_session_login
  after insert on auth.sessions
  for each row execute function private.capture_session_login();

-- Existing sessions so the page is not empty the first day
insert into public.login_activity (user_id, event, ip_address, user_agent, created_at)
select s.user_id, 'login',
       case when s.ip is null then null else host(s.ip) end,
       left(s.user_agent, 300),
       s.created_at
  from auth.sessions s
 where not exists (
   select 1 from public.login_activity a
    where a.user_id = s.user_id
      and a.created_at = s.created_at
 );

-- ---------------------------------------------------------------------
-- 3. Paginated login activity
-- ---------------------------------------------------------------------
create or replace function public.admin_login_activity(
  p_q         text default '',
  p_page      int  default 1,
  p_page_size int  default 25
)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_page int := greatest(coalesce(p_page, 1), 1);
  v_size int := least(greatest(coalesce(p_page_size, 25), 1), 100);
  v_q    text := lower(btrim(coalesce(p_q, '')));
  v_total bigint;
  v_rows jsonb;
begin
  if not private.is_platform_admin() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  select count(*) into v_total
    from public.login_activity a
    left join auth.users u on u.id = a.user_id
   where v_q = ''
      or lower(coalesce(u.email::text, '')) like '%' || v_q || '%'
      or lower(coalesce(a.ip_address, '')) like '%' || v_q || '%'
      or exists (
           select 1
             from public.tenant_members m
             join public.tenants t on t.id = m.tenant_id
            where m.user_id = a.user_id
              and lower(t.name) like '%' || v_q || '%'
         );

  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]'::jsonb)
    into v_rows
    from (
      select a.id, a.user_id, a.event, a.ip_address, a.user_agent, a.created_at,
             u.email::text as email,
             (select pr.full_name from public.profiles pr where pr.id = a.user_id) as full_name,
             exists (select 1 from public.platform_admins pa where pa.user_id = a.user_id) as is_platform_admin,
             coalesce((
               select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name) order by t.name)
                 from public.tenant_members m
                 join public.tenants t on t.id = m.tenant_id
                where m.user_id = a.user_id
             ), '[]'::jsonb) as shops
        from public.login_activity a
        left join auth.users u on u.id = a.user_id
       where v_q = ''
          or lower(coalesce(u.email::text, '')) like '%' || v_q || '%'
          or lower(coalesce(a.ip_address, '')) like '%' || v_q || '%'
          or exists (
               select 1
                 from public.tenant_members m
                 join public.tenants t on t.id = m.tenant_id
                where m.user_id = a.user_id
                  and lower(t.name) like '%' || v_q || '%'
             )
       order by a.created_at desc
       limit v_size
       offset (v_page - 1) * v_size
    ) x;

  return jsonb_build_object('total', v_total, 'page', v_page, 'page_size', v_size, 'rows', v_rows);
end $$;

-- Currently signed-in devices (auth.sessions)
create or replace function public.admin_active_sessions()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.is_platform_admin() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', s.id,
             'user_id', s.user_id,
             'email', u.email,
             'full_name', (select pr.full_name from public.profiles pr where pr.id = s.user_id),
             'ip_address', case when s.ip is null then null else host(s.ip) end,
             'user_agent', left(s.user_agent, 300),
             'created_at', s.created_at,
             'refreshed_at', s.refreshed_at,
             'is_platform_admin', exists (select 1 from public.platform_admins pa where pa.user_id = s.user_id),
             'shops', coalesce((
               select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name) order by t.name)
                 from public.tenant_members m
                 join public.tenants t on t.id = m.tenant_id
                where m.user_id = s.user_id
             ), '[]'::jsonb)
           ) order by s.created_at desc)
      from auth.sessions s
      left join auth.users u on u.id = s.user_id
  ), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------
-- 4. Global health — shops that need a look
-- ---------------------------------------------------------------------
create or replace function public.admin_health()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.is_platform_admin() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'suspended', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'slug', t.slug) order by t.name)
        from public.tenants t where t.status = 'suspended'
    ), '[]'::jsonb),
    'past_due', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', t.id, 'name', t.name, 'grace_ends_at', s.grace_ends_at
             ) order by s.grace_ends_at nulls last)
        from public.subscriptions s
        join public.tenants t on t.id = s.tenant_id
       where s.status = 'past_due'
    ), '[]'::jsonb),
    'trials_ending_7d', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', t.id, 'name', t.name, 'trial_ends_at', s.trial_ends_at
             ) order by s.trial_ends_at)
        from public.subscriptions s
        join public.tenants t on t.id = s.tenant_id
       where s.status = 'trialing'
         and s.trial_ends_at is not null
         and s.trial_ends_at <= now() + interval '7 days'
    ), '[]'::jsonb),
    'mpesa_failed_7d', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'count', x.c) order by x.c desc)
        from (
          select t.id, t.name, count(*)::int as c
            from public.mpesa_transactions m
            join public.tenants t on t.id = m.tenant_id
           where m.status = 'failed' and m.created_at >= now() - interval '7 days'
           group by t.id, t.name
        ) x
    ), '[]'::jsonb),
    'mpesa_unmatched', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'count', x.c) order by x.c desc)
        from (
          select t.id, t.name, count(*)::int as c
            from public.mpesa_transactions m
            join public.tenants t on t.id = m.tenant_id
           where m.matched_at is null and m.status = 'success'
           group by t.id, t.name
        ) x
    ), '[]'::jsonb),
    'etims_failed', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'count', x.c) order by x.c desc)
        from (
          select t.id, t.name, count(*)::int as c
            from public.sales s
            join public.tenants t on t.id = s.tenant_id
           where s.etims_status = 'failed'
           group by t.id, t.name
        ) x
    ), '[]'::jsonb),
    'etims_pending', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'count', x.c) order by x.c desc)
        from (
          select t.id, t.name, count(*)::int as c
            from public.sales s
            join public.tenants t on t.id = s.tenant_id
           where s.etims_status = 'pending'
           group by t.id, t.name
        ) x
    ), '[]'::jsonb)
  );
end $$;

-- Recreate recent-actions with IP / UA (OUT columns changed → drop first)
drop function if exists public.admin_recent_actions(int);
create or replace function public.admin_recent_actions(p_limit int default 25)
returns table (
  id uuid, admin_id uuid, admin_email text, action text, tenant_id uuid, tenant_name text,
  detail jsonb, created_at timestamptz, ip_address text, user_agent text
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.is_platform_admin() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  return query
  select l.id, l.admin_id,
         (select u.email::text from auth.users u where u.id = l.admin_id) as admin_email,
         l.action, l.target_tenant_id as tenant_id,
         (select t.name from public.tenants t where t.id = l.target_tenant_id) as tenant_name,
         l.detail, l.created_at, l.ip_address, l.user_agent
    from public.admin_audit_log l
   order by l.created_at desc
   limit least(greatest(coalesce(p_limit, 25), 1), 100);
end $$;

revoke execute on function public.admin_login_activity(text, int, int) from public, anon;
revoke execute on function public.admin_active_sessions() from public, anon;
revoke execute on function public.admin_health() from public, anon;
revoke execute on function public.admin_recent_actions(int) from public, anon;
grant execute on function public.admin_login_activity(text, int, int) to authenticated;
grant execute on function public.admin_active_sessions() to authenticated;
grant execute on function public.admin_health() to authenticated;
grant execute on function public.admin_recent_actions(int) to authenticated;
