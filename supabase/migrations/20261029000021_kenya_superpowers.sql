-- =====================================================================
-- Phase 8 / 21 — Kenya superpowers: mechanic commissions, M-Pesa verify,
-- eTIMS queue, bin locations, aliases, payment terms, blind cash-up
-- All changes are additive (no data loss). Every new table has tenant_id
-- and RLS. Money-affecting writes go through RPC functions only.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Customers: payment terms + boda stage (garage / stage accounts)
-- ---------------------------------------------------------------------
alter table public.customers
  add column if not exists payment_terms_days int not null default 0 check (payment_terms_days >= 0),
  add column if not exists boda_stage text;

comment on column public.customers.payment_terms_days is '0 = pay now, 7/14/30 = credit terms in days';
comment on column public.customers.boda_stage is 'Boda boda stage name for rider accounts, e.g. "Stage 4 - Githurai"';

-- ---------------------------------------------------------------------
-- 2. Products: slang aliases, bin location, HS / eTIMS codes
-- ---------------------------------------------------------------------
alter table public.products
  add column if not exists aliases text[] not null default '{}',
  add column if not exists aisle text,
  add column if not exists rack text,
  add column if not exists bin text,
  add column if not exists hs_code text,
  add column if not exists etims_code text;

create index if not exists products_aliases_gin on public.products using gin (aliases);
create index if not exists products_bin_idx on public.products (tenant_id, aisle, rack, bin) where deleted_at is null;

comment on column public.products.aliases is 'Kenyan mechanic slang / local names, e.g. {"kenda","coil","piston ring"}';
comment on column public.products.bin is 'Bin / box location, e.g. "Box 14" (aisle+rack+bin shown on POS)';

-- ---------------------------------------------------------------------
-- 3. Tenants: eTIMS device + M-Pesa till/paybill
-- ---------------------------------------------------------------------
alter table public.tenants
  add column if not exists etims_device_serial text,
  add column if not exists etims_vscu_serial text,
  add column if not exists etims_branch_code text,
  add column if not exists etims_oscu_id text,
  add column if not exists mpesa_till_number text,
  add column if not exists mpesa_paybill_number text;

-- ---------------------------------------------------------------------
-- 4. Sales: mechanic referral + eTIMS CU fields
-- ---------------------------------------------------------------------
alter table public.sales
  add column if not exists referred_by_customer_id uuid,
  add column if not exists mechanic_commission_amount numeric(14,2) not null default 0 check (mechanic_commission_amount >= 0),
  add column if not exists mechanic_commission_paid boolean not null default false,
  add column if not exists etims_cu_number text,
  add column if not exists etims_internal_data text,
  add column if not exists etims_receipt_signature text,
  add column if not exists etims_qr_payload text,
  add column if not exists etims_attempts int not null default 0 check (etims_attempts >= 0),
  add column if not exists etims_next_retry_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'sales_referred_by_fk') then
    alter table public.sales
      add constraint sales_referred_by_fk
      foreign key (tenant_id, referred_by_customer_id) references public.customers (tenant_id, id);
  end if;
end $$;

create index if not exists sales_referred_by_idx on public.sales (tenant_id, referred_by_customer_id) where referred_by_customer_id is not null;
create index if not exists sales_etims_queue_idx on public.sales (tenant_id, etims_status, etims_next_retry_at) where etims_status in ('pending','failed');

-- ---------------------------------------------------------------------
-- 5. Payments: M-Pesa verification (offline/manual safeguard)
-- ---------------------------------------------------------------------
alter table public.payments
  add column if not exists is_verified boolean not null default false,
  add column if not exists verified_at timestamptz,
  add column if not exists verified_by uuid;

create index if not exists payments_unverified_idx on public.payments (tenant_id, method, paid_at desc) where method = 'mpesa' and is_verified = false;

-- ---------------------------------------------------------------------
-- 6. Cash sessions: blind cash-up needs counted M-Pesa too
-- ---------------------------------------------------------------------
alter table public.cash_sessions
  add column if not exists counted_mpesa numeric(14,2),
  add column if not exists mpesa_variance numeric(14,2),
  add column if not exists counted_bank numeric(14,2),
  add column if not exists bank_variance numeric(14,2);

-- ---------------------------------------------------------------------
-- 7. Transfers: discrepancy logging + returns: type (warranty/exchange)
-- ---------------------------------------------------------------------
alter table public.stock_transfer_items
  add column if not exists discrepancy_note text;

alter table public.sale_returns
  add column if not exists return_type text not null default 'wrong_part'
    check (return_type in ('wrong_part','defective','warranty','exchange','customer_change')),
  add column if not exists exchange_sale_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'sale_returns_exchange_fk') then
    alter table public.sale_returns
      add constraint sale_returns_exchange_fk
      foreign key (tenant_id, exchange_sale_id) references public.sales (tenant_id, id);
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 8. Mechanic commissions (kickbacks owed to fundis)
-- ---------------------------------------------------------------------
create table if not exists public.mechanic_commissions (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  mechanic_id   uuid not null,
  sale_id       uuid not null,
  branch_id     uuid,
  amount        numeric(14,2) not null check (amount >= 0),
  status        text not null default 'owed' check (status in ('owed','paid','cancelled')),
  paid_at       timestamptz,
  paid_by       uuid,
  note          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, sale_id),
  foreign key (tenant_id, mechanic_id) references public.customers (tenant_id, id),
  foreign key (tenant_id, sale_id) references public.sales (tenant_id, id),
  foreign key (tenant_id, branch_id) references public.branches (tenant_id, id)
);
create index if not exists mechanic_commissions_mechanic_idx on public.mechanic_commissions (tenant_id, mechanic_id, status);
create index if not exists mechanic_commissions_sale_idx on public.mechanic_commissions (tenant_id, sale_id);

-- ---------------------------------------------------------------------
-- 9. eTIMS offline queue (chronological auto-transmit)
-- ---------------------------------------------------------------------
create table if not exists public.etims_queue (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  sale_id       uuid not null,
  status        text not null default 'queued' check (status in ('queued','sending','submitted','failed','cancelled')),
  attempts      int not null default 0 check (attempts >= 0),
  next_retry_at timestamptz not null default now(),
  last_error    text,
  payload       jsonb not null default '{}'::jsonb,
  cu_number     text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, sale_id),
  foreign key (tenant_id, sale_id) references public.sales (tenant_id, id) on delete cascade
);
create index if not exists etims_queue_due_idx on public.etims_queue (tenant_id, next_retry_at) where status in ('queued','failed');

-- ---------------------------------------------------------------------
-- 10. RLS + privileges for new tables
-- ---------------------------------------------------------------------
alter table public.mechanic_commissions enable row level security;
alter table public.etims_queue enable row level security;

do $$
declare
  ALL_ROLES text[] := array['owner','manager','cashier','storekeeper'];
  OM text[] := array['owner','manager'];
  OMC text[] := array['owner','manager','cashier'];
  BR text := 'private.can_access_branch(branch_id)';
  BR_OR_NULL text := 'branch_id is null or private.can_access_branch(branch_id)';
begin
  -- mechanic commissions: owner/manager see all, cashiers see own branch
  perform private.set_policies('mechanic_commissions', OMC, OM, OM, OM, BR_OR_NULL);
  -- etims queue: owner/manager only (service_role writes via Edge Functions)
  perform private.set_policies('etims_queue', OM, OM, OM, OM);
end $$;

grant select, insert, update, delete on public.mechanic_commissions, public.etims_queue to authenticated;
grant all on public.mechanic_commissions, public.etims_queue to service_role;

-- updated_at triggers for new tables
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_set_updated_at' and tgrelid = 'public.mechanic_commissions'::regclass) then
    create trigger trg_set_updated_at before update on public.mechanic_commissions
      for each row execute function public.set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_set_updated_at' and tgrelid = 'public.etims_queue'::regclass) then
    create trigger trg_set_updated_at before update on public.etims_queue
      for each row execute function public.set_updated_at();
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 11. Views: unverified M-Pesa, debt aging, mechanic summary, eTIMS, billing
-- ---------------------------------------------------------------------
create or replace view public.unverified_mpesa_payments with (security_invoker = true) as
select p.id, p.tenant_id, p.branch_id, p.sale_id, p.customer_id, p.amount, p.reference,
       p.paid_at, p.received_by, p.note, p.is_verified, p.cash_session_id
  from public.payments p
 where p.method = 'mpesa' and p.is_verified = false;

create or replace view public.debt_aging with (security_invoker = true) as
select c.id as customer_id, c.tenant_id, c.name, c.phone, c.customer_type,
       coalesce(b.balance, 0) as balance,
       (select min(s.sold_at) from public.sales s
         where s.customer_id = c.id and s.status in ('completed','partially_returned') and s.balance_due > 0) as oldest_unpaid_at,
       case
         when (select min(s.sold_at) from public.sales s where s.customer_id = c.id and s.status in ('completed','partially_returned') and s.balance_due > 0) is null then 'unknown'
         when (select min(s.sold_at) from public.sales s where s.customer_id = c.id and s.status in ('completed','partially_returned') and s.balance_due > 0) >= now() - interval '7 days' then '0-7'
         when (select min(s.sold_at) from public.sales s where s.customer_id = c.id and s.status in ('completed','partially_returned') and s.balance_due > 0) >= now() - interval '30 days' then '8-30'
         when (select min(s.sold_at) from public.sales s where s.customer_id = c.id and s.status in ('completed','partially_returned') and s.balance_due > 0) >= now() - interval '60 days' then '31-60'
         else '60+'
       end as bucket
  from public.customers c
  left join public.customer_balances b on b.customer_id = c.id and b.tenant_id = c.tenant_id
 where c.deleted_at is null and c.is_active and coalesce(b.balance, 0) > 0;

create or replace view public.mechanic_commission_summary with (security_invoker = true) as
select c.id as mechanic_id, c.tenant_id, c.name, c.phone,
       count(*) filter (where mc.status = 'owed') as owed_count,
       coalesce(sum(mc.amount) filter (where mc.status = 'owed'), 0) as owed_total,
       coalesce(sum(mc.amount) filter (where mc.status = 'paid'), 0) as paid_total,
       max(mc.created_at) as last_referral_at
  from public.customers c
  left join public.mechanic_commissions mc on mc.mechanic_id = c.id and mc.tenant_id = c.tenant_id
 where c.customer_type = 'mechanic' and c.deleted_at is null and c.is_active
 group by c.id, c.tenant_id, c.name, c.phone;

create or replace view public.etims_pending_queue with (security_invoker = true) as
select q.id, q.tenant_id, q.sale_id, q.status, q.attempts, q.next_retry_at, q.last_error, q.created_at,
       s.receipt_no, s.total, s.sold_at
  from public.etims_queue q
  join public.sales s on s.id = q.sale_id and s.tenant_id = q.tenant_id
 where q.status in ('queued','failed');

grant select on public.unverified_mpesa_payments, public.debt_aging,
              public.mechanic_commission_summary, public.etims_pending_queue to authenticated;
grant all on public.unverified_mpesa_payments, public.debt_aging,
          public.mechanic_commission_summary, public.etims_pending_queue to service_role;

-- ---------------------------------------------------------------------
-- 12. Refresh product_overview + customer_overview with new fields
-- CREATE OR REPLACE VIEW cannot change a column's position (Postgres
-- reads it as a rename -> 42P16), and customers_summary() depends on
-- customer_overview, so both views are dropped and re-created, then
-- grants and customers_summary() are restored.
-- ---------------------------------------------------------------------
drop function if exists public.customers_summary();
drop view if exists public.customer_overview;
drop view if exists public.product_overview;

create view public.product_overview with (security_invoker = true) as
select p.id, p.tenant_id, p.sku, p.name, p.description,
       p.category_id, c.name as category_name,
       p.brand_id, b.name as brand_name,
       p.quality_grade, p.part_number, p.unit, p.track_stock,
       p.selling_price, p.wholesale_price, p.tax_category,
       p.reorder_level, p.shelf_location, p.image_path,
       p.aliases, p.aisle, p.rack, p.bin, p.hs_code, p.etims_code,
       p.is_active, p.deleted_at, p.updated_at,
       coalesce(s.qty, 0) as stock_qty,
       (p.track_stock and p.reorder_level > 0 and coalesce(s.qty, 0) <= p.reorder_level) as is_low,
       (p.track_stock and coalesce(s.qty, 0) <= 0) as is_out,
       array(select pc.bike_model_id from public.product_compatibility pc where pc.product_id = p.id) as bike_model_ids,
       array(select pb.barcode from public.product_barcodes pb where pb.product_id = p.id) as barcodes
  from public.products p
  left join public.product_categories c on c.id = p.category_id
  left join public.brands b on b.id = p.brand_id
  left join lateral (
    select sum(sl.quantity) as qty from public.stock_levels sl where sl.product_id = p.id
  ) s on true;

create view public.customer_overview with (security_invoker = true) as
select c.id, c.tenant_id, c.name, c.phone, c.customer_type, c.price_tier, c.credit_limit,
       c.payment_terms_days, c.boda_stage,
       c.notes, c.is_active, c.deleted_at, c.created_at, c.updated_at,
       coalesce(b.balance, 0) as balance,
       (coalesce(b.balance, 0) > 0 and coalesce(b.balance, 0) > c.credit_limit) as over_limit,
       (select max(p.paid_at) from public.payments p where p.customer_id = c.id) as last_payment_at,
       (select min(s.sold_at) from public.sales s
         where s.customer_id = c.id and s.status in ('completed','partially_returned') and s.balance_due > 0) as oldest_unpaid_at
  from public.customers c
  left join public.customer_balances b on b.customer_id = c.id and b.tenant_id = c.tenant_id;

-- DROP VIEW silently discards grants, so re-issue them
grant select on public.product_overview to authenticated;
grant all on public.product_overview to service_role;
grant select on public.customer_overview to authenticated;
grant all on public.customer_overview to service_role;

-- and re-create customers_summary() exactly as migration 18 defined it
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
revoke execute on function public.customers_summary() from public, anon;
grant execute on function public.customers_summary() to authenticated;

-- ---------------------------------------------------------------------
-- 13. RPC: mechanic referral + commission
-- ---------------------------------------------------------------------
create or replace function public.set_sale_referral(p_sale_id uuid, p_mechanic_id uuid, p_commission numeric default 0)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_tenant uuid := private.tenant_id();
  s public.sales;
  v_commission numeric := round(coalesce(p_commission, 0), 2);
begin
  if v_tenant is null or not private.has_role(array['owner','manager','cashier']) then
    raise exception 'You are not allowed to set referrals' using errcode = '42501';
  end if;
  if not private.tenant_writable() then
    raise exception 'Your subscription is not active' using errcode = '42501';
  end if;
  select * into s from public.sales where id = p_sale_id and tenant_id = v_tenant for update;
  if s.id is null then
    raise exception 'Sale not found' using errcode = 'P0002';
  end if;
  if s.status not in ('completed','partially_returned') then
    raise exception 'Only a completed sale can have a referral' using errcode = '22023';
  end if;
  if p_mechanic_id is null then
    -- clear referral
    delete from public.mechanic_commissions where tenant_id = v_tenant and sale_id = p_sale_id;
    update public.sales set referred_by_customer_id = null, mechanic_commission_amount = 0, mechanic_commission_paid = false where id = p_sale_id;
    return jsonb_build_object('sale_id', p_sale_id, 'mechanic_id', null, 'commission', 0);
  end if;
  if not exists (select 1 from public.customers c where c.id = p_mechanic_id and c.tenant_id = v_tenant and c.customer_type = 'mechanic' and c.is_active and c.deleted_at is null) then
    raise exception 'Choose a mechanic (fundi) from your customers' using errcode = '22023';
  end if;
  if v_commission < 0 then
    raise exception 'Commission cannot be negative' using errcode = '22023';
  end if;
  update public.sales set referred_by_customer_id = p_mechanic_id, mechanic_commission_amount = v_commission where id = p_sale_id;
  if v_commission > 0 then
    insert into public.mechanic_commissions (tenant_id, mechanic_id, sale_id, branch_id, amount, status)
    values (v_tenant, p_mechanic_id, p_sale_id, s.branch_id, v_commission, 'owed')
    on conflict (tenant_id, sale_id) do update set mechanic_id = excluded.mechanic_id, amount = excluded.amount, branch_id = excluded.branch_id, status = 'owed', paid_at = null;
  else
    delete from public.mechanic_commissions where tenant_id = v_tenant and sale_id = p_sale_id;
  end if;
  return jsonb_build_object('sale_id', p_sale_id, 'mechanic_id', p_mechanic_id, 'commission', v_commission);
end $$;

create or replace function public.settle_mechanic_commissions(p_mechanic_id uuid, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_tenant uuid := private.tenant_id();
  v_count int; v_total numeric;
begin
  if v_tenant is null or not private.has_role(array['owner','manager']) then
    raise exception 'Only the owner or a manager can settle commissions' using errcode = '42501';
  end if;
  if not exists (select 1 from public.customers c where c.id = p_mechanic_id and c.tenant_id = v_tenant) then
    raise exception 'Mechanic not found' using errcode = 'P0002';
  end if;
  update public.mechanic_commissions
     set status = 'paid', paid_at = now(), paid_by = auth.uid(), note = nullif(btrim(coalesce(p_note, '')), '')
   where tenant_id = v_tenant and mechanic_id = p_mechanic_id and status = 'owed'
  returning amount into v_total;
  get diagnostics v_count = row_count;
  -- recompute total (returning into scalar only keeps last row)
  select coalesce(sum(amount), 0) into v_total from public.mechanic_commissions
   where tenant_id = v_tenant and mechanic_id = p_mechanic_id and status = 'paid' and paid_at >= now() - interval '5 seconds';
  update public.sales set mechanic_commission_paid = true
   where tenant_id = v_tenant and referred_by_customer_id = p_mechanic_id and mechanic_commission_paid = false;
  return jsonb_build_object('mechanic_id', p_mechanic_id, 'settled_count', v_count, 'settled_total', coalesce(v_total, 0));
end $$;

-- ---------------------------------------------------------------------
-- 14. RPC: verify an M-Pesa code (end-of-day reconciliation)
-- ---------------------------------------------------------------------
create or replace function public.verify_mpesa_payment(p_payment_id uuid, p_verified boolean default true)
returns void
language plpgsql security definer set search_path = ''
as $$
declare v_tenant uuid := private.tenant_id();
begin
  if v_tenant is null or not private.has_role(array['owner','manager']) then
    raise exception 'Only the owner or a manager can verify M-Pesa codes' using errcode = '42501';
  end if;
  if not exists (select 1 from public.payments p where p.id = p_payment_id and p.tenant_id = v_tenant and p.method = 'mpesa') then
    raise exception 'M-Pesa payment not found' using errcode = 'P0002';
  end if;
  update public.payments
     set is_verified = p_verified, verified_at = case when p_verified then now() else null end,
         verified_by = case when p_verified then auth.uid() else null end
   where id = p_payment_id and tenant_id = v_tenant;
end $$;

-- ---------------------------------------------------------------------
-- 15. RPC: eTIMS queue (offline-safe, chronological)
-- ---------------------------------------------------------------------
create or replace function public.queue_etims_invoice(p_sale_id uuid)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_tenant uuid := private.tenant_id();
  s public.sales;
  v_id uuid;
begin
  if v_tenant is null or not private.has_role(array['owner','manager','cashier']) then
    raise exception 'You are not allowed to queue eTIMS invoices' using errcode = '42501';
  end if;
  select * into s from public.sales where id = p_sale_id and tenant_id = v_tenant;
  if s.id is null then
    raise exception 'Sale not found' using errcode = 'P0002';
  end if;
  if s.status not in ('completed','partially_returned') then
    raise exception 'Only a completed sale can be sent to eTIMS' using errcode = '22023';
  end if;
  insert into public.etims_queue (tenant_id, sale_id, status, payload)
  values (v_tenant, p_sale_id, 'queued', jsonb_build_object('receipt_no', s.receipt_no, 'total', s.total, 'sold_at', s.sold_at))
  on conflict (tenant_id, sale_id) do update set status = 'queued', next_retry_at = now(), last_error = null
  returning id into v_id;
  update public.sales set etims_status = 'pending', etims_next_retry_at = now(), etims_error = null where id = p_sale_id;
  return v_id;
end $$;

create or replace function public.etims_queue_summary()
returns jsonb language sql stable set search_path = ''
as $$
  select jsonb_build_object(
    'queued', count(*) filter (where status = 'queued'),
    'failed', count(*) filter (where status = 'failed'),
    'submitted', count(*) filter (where status = 'submitted'))
  from public.etims_queue where tenant_id = private.tenant_id()
$$;

-- ---------------------------------------------------------------------
-- 16. RPC: blind cash-up (counted cash + counted M-Pesa, expected hidden)
-- ---------------------------------------------------------------------
create or replace function public.close_cash_session_blind(
  p_session_id uuid, p_counted_cash numeric, p_counted_mpesa numeric default null, p_notes text default null
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_tenant uuid := private.tenant_id();
  s public.cash_sessions;
  t jsonb;
  v_expected_cash numeric; v_expected_mpesa numeric;
begin
  if v_tenant is null or not private.has_role(array['owner','manager','cashier']) then
    raise exception 'You are not allowed to close a till' using errcode = '42501';
  end if;
  if p_counted_cash is null or p_counted_cash < 0 then
    raise exception 'Enter the cash you counted in the drawer' using errcode = '22023';
  end if;
  if p_counted_mpesa is not null and p_counted_mpesa < 0 then
    raise exception 'Enter the M-Pesa Till total you counted' using errcode = '22023';
  end if;
  select * into s from public.cash_sessions where id = p_session_id and tenant_id = v_tenant for update;
  if s.id is null then
    raise exception 'Till not found' using errcode = 'P0002';
  end if;
  if s.status <> 'open' then
    raise exception 'This till is already closed';
  end if;
  if not (private.can_access_branch(s.branch_id) and (private.has_role(array['owner','manager']) or s.opened_by = auth.uid())) then
    raise exception 'You cannot close this till' using errcode = '42501';
  end if;

  t := public.session_totals(p_session_id);
  v_expected_cash := (t ->> 'expected_cash')::numeric;
  v_expected_mpesa := (t ->> 'mpesa_in')::numeric;

  update public.cash_sessions
     set status = 'closed', closed_by = auth.uid(), closed_at = now(),
         expected_cash = v_expected_cash,
         counted_cash = p_counted_cash,
         cash_variance = p_counted_cash - v_expected_cash,
         expected_mpesa = v_expected_mpesa,
         counted_mpesa = p_counted_mpesa,
         mpesa_variance = case when p_counted_mpesa is null then null else p_counted_mpesa - v_expected_mpesa end,
         expected_bank = (t ->> 'bank_in')::numeric,
         notes = nullif(btrim(coalesce(p_notes, '')), '')
   where id = s.id;

  return public.session_totals(p_session_id);
end $$;

-- Blind totals: never reveal expected cash/M-Pesa while the till is open
create or replace function public.session_totals_blind(p_session_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_tenant uuid := private.tenant_id();
  s public.cash_sessions;
  t jsonb;
begin
  select * into s from public.cash_sessions where id = p_session_id and tenant_id = v_tenant;
  if s.id is null then
    raise exception 'Till not found' using errcode = 'P0002';
  end if;
  t := public.session_totals(p_session_id);
  if s.status = 'open' then
    -- strip the answers: the cashier must count blind
    t := t - 'expected_cash' - 'mpesa_in' - 'bank_in' - 'cash_in';
    t := t || jsonb_build_object('blind', true, 'sales_count', t -> 'sales_count', 'sales_total', t -> 'sales_total');
  else
    t := t || jsonb_build_object('blind', false);
  end if;
  return t;
end $$;

-- ---------------------------------------------------------------------
-- 17. RPC: billing status (grace warnings before lock)
-- ---------------------------------------------------------------------
create or replace function public.billing_status()
returns jsonb language sql stable set search_path = ''
as $$
  select jsonb_build_object(
    'status', s.status,
    'plan_code', p.code,
    'plan_name', p.name,
    'price_monthly', p.price_monthly,
    'trial_ends_at', s.trial_ends_at,
    'current_period_end', s.current_period_end,
    'grace_ends_at', s.grace_ends_at,
    'days_left', case when s.trial_ends_at is not null then greatest(0, ceil(extract(epoch from (s.trial_ends_at - now())) / 86400))::int else null end,
    'grace_days_left', case when s.grace_ends_at is not null then greatest(0, ceil(extract(epoch from (s.grace_ends_at - now())) / 86400))::int else null end,
    'writable', private.tenant_writable()
  )
  from public.subscriptions s
  join public.plans p on p.id = s.plan_id
  where s.tenant_id = private.tenant_id()
$$;

create or replace function public.debt_aging_summary()
returns jsonb language sql stable set search_path = ''
as $$
  select jsonb_build_object(
    '0-7',   jsonb_build_object('count', count(*) filter (where bucket = '0-7'),   'total', coalesce(sum(balance) filter (where bucket = '0-7'), 0)),
    '8-30',  jsonb_build_object('count', count(*) filter (where bucket = '8-30'),  'total', coalesce(sum(balance) filter (where bucket = '8-30'), 0)),
    '31-60', jsonb_build_object('count', count(*) filter (where bucket = '31-60'), 'total', coalesce(sum(balance) filter (where bucket = '31-60'), 0)),
    '60+',   jsonb_build_object('count', count(*) filter (where bucket = '60+'),   'total', coalesce(sum(balance) filter (where bucket = '60+'), 0)),
    'unknown', jsonb_build_object('count', count(*) filter (where bucket = 'unknown'), 'total', coalesce(sum(balance) filter (where bucket = 'unknown'), 0))
  )
  from public.debt_aging where tenant_id = private.tenant_id()
$$;

-- ---------------------------------------------------------------------
-- 18. Grants
-- ---------------------------------------------------------------------
revoke execute on function public.set_sale_referral(uuid, uuid, numeric) from public, anon;
revoke execute on function public.settle_mechanic_commissions(uuid, text) from public, anon;
revoke execute on function public.verify_mpesa_payment(uuid, boolean) from public, anon;
revoke execute on function public.queue_etims_invoice(uuid) from public, anon;
revoke execute on function public.etims_queue_summary() from public, anon;
revoke execute on function public.close_cash_session_blind(uuid, numeric, numeric, text) from public, anon;
revoke execute on function public.session_totals_blind(uuid) from public, anon;
revoke execute on function public.billing_status() from public, anon;
revoke execute on function public.debt_aging_summary() from public, anon;

grant execute on function public.set_sale_referral(uuid, uuid, numeric) to authenticated;
grant execute on function public.settle_mechanic_commissions(uuid, text) to authenticated;
grant execute on function public.verify_mpesa_payment(uuid, boolean) to authenticated;
grant execute on function public.queue_etims_invoice(uuid) to authenticated;
grant execute on function public.etims_queue_summary() to authenticated;
grant execute on function public.close_cash_session_blind(uuid, numeric, numeric, text) to authenticated;
grant execute on function public.session_totals_blind(uuid) to authenticated;
grant execute on function public.billing_status() to authenticated;
grant execute on function public.debt_aging_summary() to authenticated;

-- M-Pesa transactions stay Edge-Function-only (already revoked in 12)
revoke insert, update, delete on public.mpesa_transactions from authenticated;
