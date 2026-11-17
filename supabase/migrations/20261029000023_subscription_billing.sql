-- =====================================================================
-- Phase 8 / 23 — subscription billing via M-Pesa STK Push
-- create_subscription_invoice(): owner/manager creates an invoice for a
-- plan; the app then triggers an STK push for that invoice. The
-- mpesa-callback function marks the invoice paid and extends (or starts)
-- the subscription period, switching the tenant to that plan.
-- Works even when the subscription is expired (billing must never be
-- locked behind tenant_writable()).
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

  select * into v_sub from public.subscriptions where tenant_id = v_tenant;
  -- If the current period is still running, stack the new month on top of it;
  -- otherwise start today.
  if v_sub.id is not null and v_sub.status in ('active','trialing','past_due')
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
  select v_tenant, s.id, v_plan.id, v_start, v_end, v_plan.price_monthly, 'open', v_start
    from public.subscriptions s where s.tenant_id = v_tenant
  returning id into v_id;

  return jsonb_build_object('invoice_id', v_id, 'amount', v_plan.price_monthly, 'plan_code', v_plan.code, 'plan_name', v_plan.name, 'period_end', v_end);
end $$;

revoke execute on function public.create_subscription_invoice(text) from public, anon;
grant  execute on function public.create_subscription_invoice(text) to authenticated;
