-- =====================================================================
-- Phase 6a / 18 — Customers on credit
--   record_customer_payment() : a customer pays off debt (oldest sales first)
--   add_opening_balance()     : debt that existed before the system (the notebook)
--   adjust_customer_balance() : write-off / correction, with a reason
--   customer_overview         : customers + balance + age of debt (for lists)
--   customers_summary()       : dashboard numbers
--   sms_allowed()             : may this user send SMS reminders?
-- =====================================================================

alter table public.payments add column if not exists group_id uuid;   -- ties together the parts of one repayment
create index if not exists payments_group on public.payments (tenant_id, group_id) where group_id is not null;

-- ---------------------------------------------------------------------
-- Customer list view (runs with the caller's permissions)
-- ---------------------------------------------------------------------
create or replace view public.customer_overview with (security_invoker = true) as
select c.id, c.tenant_id, c.name, c.phone, c.customer_type, c.price_tier, c.credit_limit,
       c.notes, c.is_active, c.deleted_at, c.created_at, c.updated_at,
       coalesce(b.balance, 0) as balance,
       (coalesce(b.balance, 0) > 0 and coalesce(b.balance, 0) > c.credit_limit) as over_limit,
       (select max(p.paid_at) from public.payments p where p.customer_id = c.id) as last_payment_at,
       (select min(s.sold_at) from public.sales s
         where s.customer_id = c.id and s.status in ('completed','partially_returned') and s.balance_due > 0) as oldest_unpaid_at
  from public.customers c
  left join public.customer_balances b on b.customer_id = c.id and b.tenant_id = c.tenant_id;

grant select on public.customer_overview to authenticated;
grant all on public.customer_overview to service_role;

create or replace function public.customers_summary()
returns jsonb language sql stable set search_path = ''
as $$
  select jsonb_build_object(
    'owing_count',      count(*) filter (where balance > 0),
    'total_owed',       coalesce(sum(balance) filter (where balance > 0), 0),
    'over_limit_count', count(*) filter (where over_limit))
  from public.customer_overview
  where deleted_at is null and is_active
$$;

-- ---------------------------------------------------------------------
-- A customer pays: cash / M-Pesa / bank
--   p_data: {customer_id, branch_id, amount, method, reference, note, client_uuid}
-- The money is shared over the customer's unpaid sales, oldest first, so each
-- sale shows what is still owed. Any extra stays as credit on the account.
-- ---------------------------------------------------------------------
create or replace function public.record_customer_payment(p_data jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_tenant   uuid := private.tenant_id();
  v_user     uuid := auth.uid();
  v_customer uuid := nullif(p_data ->> 'customer_id', '')::uuid;
  v_branch   uuid := nullif(p_data ->> 'branch_id', '')::uuid;
  v_client   uuid := nullif(p_data ->> 'client_uuid', '')::uuid;
  v_amount   numeric := round(coalesce(nullif(p_data ->> 'amount', '')::numeric, 0), 2);
  v_method   text := lower(coalesce(p_data ->> 'method', ''));
  v_ref      text := nullif(upper(btrim(coalesce(p_data ->> 'reference', ''))), '');
  v_note     text := nullif(btrim(coalesce(p_data ->> 'note', '')), '');
  cu public.customers;
  s  record;
  v_group uuid := gen_random_uuid();
  v_remaining numeric;
  v_portion   numeric;
  v_allocated numeric := 0;
  v_first boolean := true;
  v_session uuid;
  v_balance numeric;
  v_old uuid;
begin
  if v_tenant is null or not private.has_role(array['owner','manager','cashier']) then
    raise exception 'You are not allowed to receive payments' using errcode = '42501';
  end if;
  if not private.tenant_writable() then
    raise exception 'Your subscription is not active' using errcode = '42501';
  end if;
  if v_branch is null or not private.can_access_branch(v_branch) then
    raise exception 'You cannot receive money in that branch' using errcode = '42501';
  end if;
  if v_method not in ('cash','mpesa','bank','other') then
    raise exception 'Choose how the customer paid' using errcode = '22023';
  end if;
  if v_amount <= 0 then
    raise exception 'Enter an amount more than zero' using errcode = '22023';
  end if;

  select * into cu from public.customers c where c.id = v_customer and c.tenant_id = v_tenant;
  if cu.id is null then
    raise exception 'Customer not found' using errcode = '22023';
  end if;

  -- the same payment sent twice is recorded once
  if v_client is not null then
    select p.group_id into v_old from public.payments p where p.tenant_id = v_tenant and p.client_uuid = v_client;
    if v_old is not null then
      select coalesce(sum(l.amount), 0) into v_balance from public.customer_ledger l where l.tenant_id = v_tenant and l.customer_id = v_customer;
      return jsonb_build_object('group_id', v_old, 'customer', cu.name, 'amount', v_amount, 'balance_after', v_balance, 'duplicate', true);
    end if;
  end if;

  if v_method = 'mpesa' then
    if v_ref is null or v_ref !~ '^[A-Z0-9]{8,12}$' then
      raise exception 'Enter the M-Pesa transaction code (8 to 12 letters and numbers)' using errcode = '22023';
    end if;
    if exists (select 1 from public.payments pm where pm.tenant_id = v_tenant and pm.method = 'mpesa' and pm.reference = v_ref) then
      raise exception 'M-Pesa code % was already used', v_ref using errcode = '23505';
    end if;
  end if;

  select cs.id into v_session from public.cash_sessions cs
   where cs.tenant_id = v_tenant and cs.branch_id = v_branch and cs.opened_by = v_user and cs.status = 'open';
  if v_session is null then
    insert into public.cash_sessions (tenant_id, branch_id, opened_by, opening_float)
    values (v_tenant, v_branch, v_user, 0) returning id into v_session;
  end if;

  v_remaining := v_amount;
  if v_method = 'mpesa' then
    v_note := coalesce(v_note || ' · ', '') || 'M-Pesa code entered by staff (not yet verified)';
  end if;

  -- oldest unpaid sales first
  for s in
    select sa.id, sa.balance_due from public.sales sa
     where sa.tenant_id = v_tenant and sa.customer_id = v_customer
       and sa.status in ('completed','partially_returned') and sa.balance_due > 0
     order by sa.sold_at, sa.id
     for update
  loop
    exit when v_remaining <= 0;
    v_portion := least(v_remaining, s.balance_due);
    insert into public.payments
      (tenant_id, branch_id, kind, sale_id, customer_id, method, amount, reference, cash_session_id,
       received_by, paid_at, client_uuid, note, group_id)
    values
      (v_tenant, v_branch, 'debt_repayment', s.id, v_customer, v_method::public.payment_method, v_portion,
       case when v_first then v_ref end, v_session, v_user, now(),
       case when v_first then v_client end,
       case when v_first then v_note else 'Part of the same payment (' || coalesce(v_ref, 'no code') || ')' end,
       v_group);
    v_remaining := v_remaining - v_portion;
    v_allocated := v_allocated + v_portion;
    v_first := false;
  end loop;

  -- extra money (or debt that has no sale, like an opening balance): credit on the account
  if v_remaining > 0 then
    insert into public.payments
      (tenant_id, branch_id, kind, sale_id, customer_id, method, amount, reference, cash_session_id,
       received_by, paid_at, client_uuid, note, group_id)
    values
      (v_tenant, v_branch, 'debt_repayment', null, v_customer, v_method::public.payment_method, v_remaining,
       case when v_first then v_ref end, v_session, v_user, now(),
       case when v_first then v_client end,
       case when v_first then v_note else 'Part of the same payment (' || coalesce(v_ref, 'no code') || ')' end,
       v_group);
  end if;

  select coalesce(sum(l.amount), 0) into v_balance
    from public.customer_ledger l where l.tenant_id = v_tenant and l.customer_id = v_customer;

  return jsonb_build_object('group_id', v_group, 'customer', cu.name, 'amount', v_amount,
                            'to_sales', v_allocated, 'extra', v_remaining, 'balance_after', v_balance);
end $$;

-- ---------------------------------------------------------------------
-- Debt from before the system (owner / manager)
-- ---------------------------------------------------------------------
create or replace function public.add_opening_balance(p_customer_id uuid, p_amount numeric, p_note text default null)
returns numeric
language plpgsql security definer set search_path = ''
as $$
declare v_tenant uuid := private.tenant_id(); v_name text; v_balance numeric;
begin
  if v_tenant is null or not private.has_role(array['owner','manager']) then
    raise exception 'Only the owner or a manager can add an opening balance' using errcode = '42501';
  end if;
  if not private.tenant_writable() then
    raise exception 'Your subscription is not active' using errcode = '42501';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Enter the amount the customer already owed' using errcode = '22023';
  end if;
  select c.name into v_name from public.customers c where c.id = p_customer_id and c.tenant_id = v_tenant;
  if v_name is null then
    raise exception 'Customer not found' using errcode = '22023';
  end if;

  insert into public.customer_ledger (tenant_id, customer_id, entry_type, amount, note, created_by)
  values (v_tenant, p_customer_id, 'opening_balance', round(p_amount, 2),
          coalesce(nullif(btrim(coalesce(p_note, '')), ''), 'Opening balance (debt from before the system)'), auth.uid());

  insert into public.audit_logs (tenant_id, user_id, action, table_name, record_id, new_data)
  values (v_tenant, auth.uid(), 'opening_balance', 'customer_ledger', p_customer_id::text,
          jsonb_build_object('customer', v_name, 'amount', round(p_amount, 2), 'note', p_note));

  select coalesce(sum(l.amount), 0) into v_balance from public.customer_ledger l where l.tenant_id = v_tenant and l.customer_id = p_customer_id;
  return v_balance;
end $$;

-- ---------------------------------------------------------------------
-- Write off or correct a balance (owner / manager). Negative = reduces the debt.
-- ---------------------------------------------------------------------
create or replace function public.adjust_customer_balance(p_customer_id uuid, p_amount numeric, p_reason text)
returns numeric
language plpgsql security definer set search_path = ''
as $$
declare v_tenant uuid := private.tenant_id(); v_name text; v_balance numeric;
begin
  if v_tenant is null or not private.has_role(array['owner','manager']) then
    raise exception 'Only the owner or a manager can adjust a balance' using errcode = '42501';
  end if;
  if not private.tenant_writable() then
    raise exception 'Your subscription is not active' using errcode = '42501';
  end if;
  if p_amount is null or p_amount = 0 then
    raise exception 'Enter the amount to add or remove' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Please give a reason' using errcode = '22023';
  end if;
  select c.name into v_name from public.customers c where c.id = p_customer_id and c.tenant_id = v_tenant;
  if v_name is null then
    raise exception 'Customer not found' using errcode = '22023';
  end if;

  insert into public.customer_ledger (tenant_id, customer_id, entry_type, amount, note, created_by)
  values (v_tenant, p_customer_id, 'adjustment', round(p_amount, 2), 'Adjustment: ' || btrim(p_reason), auth.uid());

  insert into public.audit_logs (tenant_id, user_id, action, table_name, record_id, new_data)
  values (v_tenant, auth.uid(), 'debt_adjustment', 'customer_ledger', p_customer_id::text,
          jsonb_build_object('customer', v_name, 'amount', round(p_amount, 2), 'reason', btrim(p_reason)));

  select coalesce(sum(l.amount), 0) into v_balance from public.customer_ledger l where l.tenant_id = v_tenant and l.customer_id = p_customer_id;
  return v_balance;
end $$;

-- ---------------------------------------------------------------------
-- May this user send SMS reminders?  (owner/manager on a plan that includes SMS)
-- ---------------------------------------------------------------------
create or replace function public.sms_allowed()
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'role_ok', private.has_role(array['owner','manager']),
    'plan_ok', coalesce((select (p.features ->> 'sms')::boolean
                           from public.subscriptions s join public.plans p on p.id = s.plan_id
                          where s.tenant_id = private.tenant_id()), false),
    'shop',    (select t.name from public.tenants t where t.id = private.tenant_id()))
$$;

-- ---------------------------------------------------------------------
revoke execute on function public.customers_summary() from public, anon;
revoke execute on function public.record_customer_payment(jsonb) from public, anon;
revoke execute on function public.add_opening_balance(uuid, numeric, text) from public, anon;
revoke execute on function public.adjust_customer_balance(uuid, numeric, text) from public, anon;
revoke execute on function public.sms_allowed() from public, anon;
grant execute on function public.customers_summary() to authenticated;
grant execute on function public.record_customer_payment(jsonb) to authenticated;
grant execute on function public.add_opening_balance(uuid, numeric, text) to authenticated;
grant execute on function public.adjust_customer_balance(uuid, numeric, text) to authenticated;
grant execute on function public.sms_allowed() to authenticated;
