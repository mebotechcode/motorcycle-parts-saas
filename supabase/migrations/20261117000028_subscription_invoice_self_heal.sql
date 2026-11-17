-- =====================================================================
-- Phase 8 / 28 — create_subscription_invoice self-heals missing rows
-- Before: if the tenant had no subscriptions row (legacy/seed-created
-- tenant, or a row removed out of band), the INSERT..SELECT below
-- inserted zero rows, v_id stayed NULL and the RPC silently returned
-- { invoice_id: null } — the app then could not trigger the STK push
-- and the owner was stuck with no way to pay.
-- Now: the missing row is created on the Starter plan, expired
-- yesterday, so payment extends the tenant normally (same code path as
-- an expired subscription). If even that is impossible (starter plan not
-- seeded), the RPC raises a loud error instead of returning null.
-- =====================================================================

create or replace function public.create_subscription_invoice(p_plan_code text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_tenant uuid := private.tenant_id();
  v_plan   public.plans;
  v_sub    public.subscriptions;
  v_start  date;
  v_end    date;
  v_id     uuid;
begin
  if v_tenant is null or not private.has_role(array['owner','manager']) then
    raise exception 'Only the owner or a manager can pay the subscription' using errcode = '42501';
  end if;

  select * into v_plan from public.plans where code = lower(btrim(p_plan_code)) and is_active;
  if v_plan.id is null then
    raise exception 'Unknown plan "%"', p_plan_code using errcode = '22023';
  end if;

  select * into v_sub from public.subscriptions where tenant_id = v_tenant for update;

  -- Self-heal: a tenant with no subscription row gets an expired Starter
  -- one. The M-Pesa callback extends the subscription period on payment,
  -- so this behaves exactly like an existing-but-expired subscription.
  if v_sub.id is null then
    insert into public.subscriptions
      (tenant_id, plan_id, status, trial_ends_at, current_period_start, current_period_end)
    select v_tenant, p.id, 'past_due', now(), now() - interval '1 day', now() - interval '1 day'
      from public.plans p
     where p.code = 'starter' and p.is_active
    returning * into v_sub;
    if v_sub.id is null then
      raise exception 'This shop has no subscription and the starter plan is not seeded. Ask support for help.' using errcode = '23503';
    end if;
  end if;

  -- If the current period is still running, stack the new month on top of it;
  -- otherwise start today.
  if v_sub.status in ('active','trialing','past_due')
     and v_sub.current_period_end is not null and v_sub.current_period_end > now() then
    v_start := v_sub.current_period_end::date;
  else
    v_start := current_date;
  end if;
  v_end := (v_start + interval '1 month')::date;

  -- Reuse an open invoice for the same plan instead of stacking duplicates
  select id into v_id from public.subscription_invoices
   where tenant_id = v_tenant and plan_id = v_plan.id and status = 'open' and due_date >= current_date
   order by created_at desc limit 1;
  if v_id is not null then
    return jsonb_build_object('invoice_id', v_id, 'amount', v_plan.price_monthly, 'plan_code', v_plan.code, 'plan_name', v_plan.name, 'period_end', v_end);
  end if;

  insert into public.subscription_invoices (tenant_id, subscription_id, plan_id, period_start, period_end, amount, status, due_date)
  values (v_tenant, v_sub.id, v_plan.id, v_start, v_end, v_plan.price_monthly, 'open', v_start)
  returning id into v_id;

  return jsonb_build_object('invoice_id', v_id, 'amount', v_plan.price_monthly, 'plan_code', v_plan.code, 'plan_name', v_plan.name, 'period_end', v_end);
end $$;

revoke execute on function public.create_subscription_invoice(text) from public, anon;
grant  execute on function public.create_subscription_invoice(text) to authenticated;
