-- =====================================================================
-- Phase 9 / 30 — Super-admin v2: shop detail, billing ops, support notes,
-- server-side paginated tenant list (safe at 100–300+ shops).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Support notes (operator-only; shops never see these)
-- ---------------------------------------------------------------------
create table if not exists public.admin_support_notes (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  admin_id   uuid not null,
  body       text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists admin_support_notes_tenant_idx
  on public.admin_support_notes (tenant_id, created_at desc);

alter table public.admin_support_notes enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'admin_support_notes'
       and policyname = 'admin_support_notes_admin_read'
  ) then
    create policy admin_support_notes_admin_read on public.admin_support_notes
      for select to authenticated using ((select private.is_platform_admin()));
  end if;
end $$;

grant select on public.admin_support_notes to authenticated;
grant all on public.admin_support_notes to service_role;

-- ---------------------------------------------------------------------
-- 2. Replace admin_tenants() with a paginated + searchable version.
--    Old signature returned a table of every shop — drop it first.
-- ---------------------------------------------------------------------
drop function if exists public.admin_tenants();

create or replace function public.admin_tenants(
  p_q         text default '',
  p_status    text default 'all',
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
  v_st   text := lower(btrim(coalesce(p_status, 'all')));
  v_total bigint;
  v_rows jsonb;
begin
  if not private.is_platform_admin() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if v_st not in ('all','active','suspended','closed','attention') then
    v_st := 'all';
  end if;

  select count(*) into v_total
    from public.tenants t
    left join public.subscriptions s on s.tenant_id = t.id
    left join public.plans p on p.id = s.plan_id
   where (v_q = ''
          or lower(t.name) like '%' || v_q || '%'
          or lower(t.slug) like '%' || v_q || '%'
          or lower(coalesce(t.town, '')) like '%' || v_q || '%'
          or lower(coalesce(t.phone, '')) like '%' || v_q || '%'
          or lower(coalesce(t.email, '')) like '%' || v_q || '%'
          or lower(coalesce(p.name, '')) like '%' || v_q || '%'
          or lower(coalesce(p.code, '')) like '%' || v_q || '%')
     and (
          v_st = 'all'
       or (v_st = 'active'     and t.status = 'active')
       or (v_st = 'suspended'  and t.status = 'suspended')
       or (v_st = 'closed'     and t.status = 'closed')
       or (v_st = 'attention'  and (
              t.status = 'suspended'
           or s.status = 'past_due'
           or (s.status = 'trialing' and s.trial_ends_at is not null
               and s.trial_ends_at <= now() + interval '7 days')
       ))
     );

  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]'::jsonb)
    into v_rows
    from (
      select t.id, t.name, t.slug, t.status::text, t.town, t.phone, t.email, t.created_at,
             coalesce(p.name, '—') as plan,
             coalesce(p.code, '') as plan_code,
             coalesce(s.status::text, 'none') as sub_status,
             s.trial_ends_at, s.current_period_end, s.grace_ends_at,
             (select count(*) from public.tenant_members m where m.tenant_id = t.id) as members,
             (select max(sd.sold_at) from public.sales sd where sd.tenant_id = t.id) as last_sale_at
        from public.tenants t
        left join public.subscriptions s on s.tenant_id = t.id
        left join public.plans p on p.id = s.plan_id
       where (v_q = ''
              or lower(t.name) like '%' || v_q || '%'
              or lower(t.slug) like '%' || v_q || '%'
              or lower(coalesce(t.town, '')) like '%' || v_q || '%'
              or lower(coalesce(t.phone, '')) like '%' || v_q || '%'
              or lower(coalesce(t.email, '')) like '%' || v_q || '%'
              or lower(coalesce(p.name, '')) like '%' || v_q || '%'
              or lower(coalesce(p.code, '')) like '%' || v_q || '%')
         and (
              v_st = 'all'
           or (v_st = 'active'     and t.status = 'active')
           or (v_st = 'suspended'  and t.status = 'suspended')
           or (v_st = 'closed'     and t.status = 'closed')
           or (v_st = 'attention'  and (
                  t.status = 'suspended'
               or s.status = 'past_due'
               or (s.status = 'trialing' and s.trial_ends_at is not null
                   and s.trial_ends_at <= now() + interval '7 days')
           ))
         )
       order by t.created_at desc
       limit v_size
       offset (v_page - 1) * v_size
    ) x;

  return jsonb_build_object(
    'total', v_total,
    'page', v_page,
    'page_size', v_size,
    'rows', v_rows
  );
end $$;

-- ---------------------------------------------------------------------
-- 3. One shop: contact, staff, invoices, health, notes, recent actions
-- ---------------------------------------------------------------------
create or replace function public.admin_shop(p_tenant_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_tenant jsonb;
begin
  if not private.is_platform_admin() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  select jsonb_build_object(
           'id', t.id, 'name', t.name, 'slug', t.slug, 'status', t.status,
           'town', t.town, 'phone', t.phone, 'email', t.email,
           'address', t.address, 'kra_pin', t.kra_pin,
           'vat_registered', t.vat_registered, 'created_at', t.created_at
         )
    into v_tenant
    from public.tenants t
   where t.id = p_tenant_id;
  if v_tenant is null then
    raise exception 'Tenant not found' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'tenant', v_tenant,
    'subscription', (
      select jsonb_build_object(
               'id', s.id, 'status', s.status, 'billing_cycle', s.billing_cycle,
               'plan', p.name, 'plan_code', p.code, 'price_monthly', p.price_monthly,
               'trial_ends_at', s.trial_ends_at,
               'current_period_start', s.current_period_start,
               'current_period_end', s.current_period_end,
               'grace_ends_at', s.grace_ends_at
             )
        from public.subscriptions s
        join public.plans p on p.id = s.plan_id
       where s.tenant_id = p_tenant_id
    ),
    'staff', coalesce((
      select jsonb_agg(jsonb_build_object(
               'user_id', m.user_id,
               'role', m.role,
               'status', m.status,
               'full_name', pr.full_name,
               'phone', pr.phone,
               'email', u.email,
               'joined_at', m.created_at
             ) order by case m.role when 'owner' then 0 when 'manager' then 1 else 2 end, pr.full_name)
        from public.tenant_members m
        left join public.profiles pr on pr.id = m.user_id
        left join auth.users u on u.id = m.user_id
       where m.tenant_id = p_tenant_id
    ), '[]'::jsonb),
    'invoices', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', i.id, 'amount', i.amount, 'status', i.status,
               'due_date', i.due_date, 'period_start', i.period_start,
               'period_end', i.period_end, 'paid_at', i.paid_at,
               'plan', p.name, 'created_at', i.created_at
             ) order by i.created_at desc)
        from (
          select * from public.subscription_invoices
           where tenant_id = p_tenant_id
           order by created_at desc
           limit 30
        ) i
        left join public.plans p on p.id = i.plan_id
    ), '[]'::jsonb),
    'health', jsonb_build_object(
      'last_sale_at', (select max(sold_at) from public.sales where tenant_id = p_tenant_id),
      'sales_7d', (select count(*) from public.sales where tenant_id = p_tenant_id and sold_at >= now() - interval '7 days'),
      'mpesa_failed_7d', (select count(*) from public.mpesa_transactions where tenant_id = p_tenant_id and status = 'failed' and created_at >= now() - interval '7 days'),
      'mpesa_unmatched', (select count(*) from public.mpesa_transactions where tenant_id = p_tenant_id and matched_at is null and status = 'success'),
      'etims_pending', (select count(*) from public.sales where tenant_id = p_tenant_id and etims_status = 'pending'),
      'etims_failed', (select count(*) from public.sales where tenant_id = p_tenant_id and etims_status = 'failed')
    ),
    'notes', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', n.id, 'body', n.body, 'admin_id', n.admin_id,
               'admin_email', (select u.email::text from auth.users u where u.id = n.admin_id),
               'created_at', n.created_at
             ) order by n.created_at desc)
        from (
          select * from public.admin_support_notes
           where tenant_id = p_tenant_id
           order by created_at desc
           limit 50
        ) n
    ), '[]'::jsonb),
    'actions', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', l.id, 'action', l.action, 'detail', l.detail,
               'admin_email', (select u.email::text from auth.users u where u.id = l.admin_id),
               'created_at', l.created_at
             ) order by l.created_at desc)
        from (
          select * from public.admin_audit_log
           where target_tenant_id = p_tenant_id
           order by created_at desc
           limit 20
        ) l
    ), '[]'::jsonb)
  );
end $$;

-- ---------------------------------------------------------------------
-- 4. Billing: mark paid (manual, e.g. cash / bank) or void
--    Paid path mirrors mpesa-callback: activate sub, set period from invoice.
--    Does NOT unsuspend the tenant — operator does that separately.
-- ---------------------------------------------------------------------
create or replace function public.admin_mark_invoice_paid(p_invoice_id uuid, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_inv public.subscription_invoices;
begin
  if not private.is_platform_admin() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  select * into v_inv from public.subscription_invoices where id = p_invoice_id for update;
  if v_inv.id is null then
    raise exception 'Invoice not found' using errcode = 'P0002';
  end if;
  if v_inv.status <> 'open' then
    raise exception 'Invoice is already %', v_inv.status using errcode = '22023';
  end if;

  update public.subscription_invoices
     set status = 'paid', paid_at = now(), updated_at = now()
   where id = v_inv.id;

  update public.subscriptions
     set status = 'active',
         grace_ends_at = null,
         plan_id = v_inv.plan_id,
         current_period_start = now(),
         current_period_end = v_inv.period_end::timestamptz,
         updated_at = now()
   where id = v_inv.subscription_id;

  insert into public.admin_audit_log (admin_id, action, target_tenant_id, detail)
  values (auth.uid(), 'mark_invoice_paid', v_inv.tenant_id,
          jsonb_build_object('invoice_id', v_inv.id, 'amount', v_inv.amount, 'note', p_note));
  return jsonb_build_object('ok', true, 'invoice_id', v_inv.id);
end $$;

create or replace function public.admin_void_invoice(p_invoice_id uuid, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_inv public.subscription_invoices;
begin
  if not private.is_platform_admin() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  select * into v_inv from public.subscription_invoices where id = p_invoice_id for update;
  if v_inv.id is null then
    raise exception 'Invoice not found' using errcode = 'P0002';
  end if;
  if v_inv.status <> 'open' then
    raise exception 'Invoice is already %', v_inv.status using errcode = '22023';
  end if;

  update public.subscription_invoices
     set status = 'void', updated_at = now()
   where id = v_inv.id;

  insert into public.admin_audit_log (admin_id, action, target_tenant_id, detail)
  values (auth.uid(), 'void_invoice', v_inv.tenant_id,
          jsonb_build_object('invoice_id', v_inv.id, 'amount', v_inv.amount, 'note', p_note));
  return jsonb_build_object('ok', true, 'invoice_id', v_inv.id);
end $$;

create or replace function public.admin_add_note(p_tenant_id uuid, p_body text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid;
  v_body text := btrim(coalesce(p_body, ''));
begin
  if not private.is_platform_admin() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if char_length(v_body) < 1 or char_length(v_body) > 2000 then
    raise exception 'Note must be 1 to 2000 characters' using errcode = '22023';
  end if;
  if not exists (select 1 from public.tenants where id = p_tenant_id) then
    raise exception 'Tenant not found' using errcode = 'P0002';
  end if;

  insert into public.admin_support_notes (tenant_id, admin_id, body)
  values (p_tenant_id, auth.uid(), v_body)
  returning id into v_id;

  insert into public.admin_audit_log (admin_id, action, target_tenant_id, detail)
  values (auth.uid(), 'add_note', p_tenant_id, jsonb_build_object('note_id', v_id));
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

revoke execute on function public.admin_tenants(text, text, int, int) from public, anon;
revoke execute on function public.admin_shop(uuid) from public, anon;
revoke execute on function public.admin_mark_invoice_paid(uuid, text) from public, anon;
revoke execute on function public.admin_void_invoice(uuid, text) from public, anon;
revoke execute on function public.admin_add_note(uuid, text) from public, anon;
grant execute on function public.admin_tenants(text, text, int, int) to authenticated;
grant execute on function public.admin_shop(uuid) to authenticated;
grant execute on function public.admin_mark_invoice_paid(uuid, text) to authenticated;
grant execute on function public.admin_void_invoice(uuid, text) to authenticated;
grant execute on function public.admin_add_note(uuid, text) to authenticated;
