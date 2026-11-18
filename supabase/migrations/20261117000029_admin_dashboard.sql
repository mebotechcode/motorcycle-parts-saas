-- =====================================================================
-- Phase 9 / 29 — Platform admin (SaaS super admin) dashboard
-- All admin data flows through security-definer RPCs that re-check
-- private.is_platform_admin() server-side, and every mutating action
-- writes admin_audit_log. No shop sales/stock/customer data is writable
-- by the platform admin (see migration 10's policy split).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Audit log — every admin action lands here
-- ---------------------------------------------------------------------
create table if not exists public.admin_audit_log (
  id               uuid primary key default gen_random_uuid(),
  admin_id         uuid not null,
  action           text not null,
  target_tenant_id uuid references public.tenants(id) on delete set null,
  detail           jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now()
);
create index if not exists admin_audit_log_created_idx on public.admin_audit_log (created_at desc);
create index if not exists admin_audit_log_tenant_idx on public.admin_audit_log (target_tenant_id);

alter table public.admin_audit_log enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='admin_audit_log' and policyname='admin_audit_log_admin_read') then
    create policy admin_audit_log_admin_read on public.admin_audit_log
      for select to authenticated using ((select private.is_platform_admin()));
  end if;
end $$;
-- writes happen only inside the security-definer RPCs below
grant select on public.admin_audit_log to authenticated;
grant all on public.admin_audit_log to service_role;

-- ---------------------------------------------------------------------
-- 2. KPI overview — tenant counts, plan mix, MRR, signups, invoices
-- ---------------------------------------------------------------------
create or replace function public.admin_overview()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.is_platform_admin() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'tenants_total',       (select count(*) from public.tenants),
    'tenants_active',      (select count(*) from public.tenants where status = 'active'),
    'tenants_suspended',   (select count(*) from public.tenants where status = 'suspended'),
    'trials_trialing',     (select count(*) from public.subscriptions where status = 'trialing'),
    'subs_active',         (select count(*) from public.subscriptions where status = 'active'),
    'subs_past_due',       (select count(*) from public.subscriptions where status = 'past_due'),
    'mrr',                 coalesce((select sum(p.price_monthly) from public.subscriptions s join public.plans p on p.id = s.plan_id where s.status = 'active'), 0),
    'arr_run_rate',        coalesce((select sum(p.price_monthly) * 12 from public.subscriptions s join public.plans p on p.id = s.plan_id where s.status = 'active'), 0),
    'signups_30d',         (select count(*) from public.tenants where created_at >= now() - interval '30 days'),
    'open_invoices',       (select count(*) from public.subscription_invoices where status = 'open'),
    'open_invoice_amount', coalesce((select sum(amount) from public.subscription_invoices where status = 'open'), 0),
    'collected_30d',       coalesce((select sum(amount) from public.subscription_invoices where status = 'paid' and paid_at >= now() - interval '30 days'), 0),
    'plan_mix',            coalesce((select jsonb_agg(jsonb_build_object('plan', x.name, 'count', x.c) order by x.name) from (
                              select p.name, count(*) as c
                                from public.subscriptions s join public.plans p on p.id = s.plan_id
                               where s.status in ('active','trialing','past_due')
                               group by p.name) x), '[]'::jsonb)
  );
end $$;

-- ---------------------------------------------------------------------
-- 3. Tenant list for the dashboard table
-- ---------------------------------------------------------------------
create or replace function public.admin_tenants()
returns table (
  id uuid, name text, slug text, status text, town text, created_at timestamptz,
  plan text, sub_status text, trial_ends_at timestamptz, current_period_end timestamptz,
  grace_ends_at timestamptz, members bigint, last_sale_at timestamptz
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.is_platform_admin() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  return query
  select t.id, t.name, t.slug, t.status::text, t.town, t.created_at,
         coalesce(p.name, '—') as plan,
         coalesce(s.status::text, 'none') as sub_status,
         s.trial_ends_at, s.current_period_end, s.grace_ends_at,
         (select count(*) from public.tenant_members m where m.tenant_id = t.id) as members,
         (select max(sd.sold_at) from public.sales sd where sd.tenant_id = t.id) as last_sale_at
    from public.tenants t
    left join public.subscriptions s on s.tenant_id = t.id
    left join public.plans p on p.id = s.plan_id
   order by t.created_at desc;
end $$;

-- ---------------------------------------------------------------------
-- 4. Actions (all audited)
-- ---------------------------------------------------------------------
create or replace function public.admin_set_tenant_status(p_tenant_id uuid, p_status text, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_old public.tenant_status;
begin
  if not private.is_platform_admin() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if p_status not in ('active','suspended','closed') then
    raise exception 'Unknown status "%"', p_status using errcode = '22023';
  end if;
  select status into v_old from public.tenants where id = p_tenant_id;
  if v_old is null then
    raise exception 'Tenant not found' using errcode = 'P0002';
  end if;
  update public.tenants set status = p_status::public.tenant_status, updated_at = now() where id = p_tenant_id;
  insert into public.admin_audit_log (admin_id, action, target_tenant_id, detail)
  values (auth.uid(), 'set_tenant_status', p_tenant_id,
          jsonb_build_object('from', v_old, 'to', p_status, 'note', p_note));
  return jsonb_build_object('ok', true, 'status', p_status);
end $$;

create or replace function public.admin_extend_trial(p_tenant_id uuid, p_days int, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_sub public.subscriptions;
begin
  if not private.is_platform_admin() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if p_days is null or p_days < 1 or p_days > 90 then
    raise exception 'Extend by 1 to 90 days' using errcode = '22023';
  end if;
  select * into v_sub from public.subscriptions where tenant_id = p_tenant_id for update;
  if v_sub.id is null then
    raise exception 'Tenant has no subscription row' using errcode = 'P0002';
  end if;
  update public.subscriptions
     set trial_ends_at = coalesce(trial_ends_at, now()) + make_interval(days => p_days),
         current_period_end = coalesce(current_period_end, now()) + make_interval(days => p_days),
         updated_at = now()
   where id = v_sub.id;
  insert into public.admin_audit_log (admin_id, action, target_tenant_id, detail)
  values (auth.uid(), 'extend_trial', p_tenant_id,
          jsonb_build_object('days', p_days, 'note', p_note));
  return jsonb_build_object('ok', true, 'extended_days', p_days);
end $$;

create or replace function public.admin_set_plan(p_tenant_id uuid, p_plan_code text, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_plan public.plans; v_sub public.subscriptions;
begin
  if not private.is_platform_admin() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  select * into v_plan from public.plans where code = lower(btrim(p_plan_code)) and is_active;
  if v_plan.id is null then
    raise exception 'Unknown plan "%"', p_plan_code using errcode = '22023';
  end if;
  select * into v_sub from public.subscriptions where tenant_id = p_tenant_id for update;
  if v_sub.id is null then
    raise exception 'Tenant has no subscription row' using errcode = 'P0002';
  end if;
  update public.subscriptions set plan_id = v_plan.id, updated_at = now() where id = v_sub.id;
  insert into public.admin_audit_log (admin_id, action, target_tenant_id, detail)
  values (auth.uid(), 'set_plan', p_tenant_id,
          jsonb_build_object('plan', v_plan.code, 'note', p_note));
  return jsonb_build_object('ok', true, 'plan', v_plan.code);
end $$;

create or replace function public.admin_recent_actions(p_limit int default 25)
returns table (id uuid, admin_id uuid, admin_email text, action text, tenant_id uuid, tenant_name text, detail jsonb, created_at timestamptz)
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
         l.detail, l.created_at
    from public.admin_audit_log l
   order by l.created_at desc
   limit least(greatest(coalesce(p_limit, 25), 1), 100);
end $$;

revoke execute on function public.admin_overview() from public, anon;
revoke execute on function public.admin_tenants() from public, anon;
revoke execute on function public.admin_set_tenant_status(uuid, text, text) from public, anon;
revoke execute on function public.admin_extend_trial(uuid, int, text) from public, anon;
revoke execute on function public.admin_set_plan(uuid, text, text) from public, anon;
revoke execute on function public.admin_recent_actions(int) from public, anon;
grant execute on function public.admin_overview() to authenticated;
grant execute on function public.admin_tenants() to authenticated;
grant execute on function public.admin_set_tenant_status(uuid, text, text) to authenticated;
grant execute on function public.admin_extend_trial(uuid, int, text) to authenticated;
grant execute on function public.admin_set_plan(uuid, text, text) to authenticated;
grant execute on function public.admin_recent_actions(int) to authenticated;
