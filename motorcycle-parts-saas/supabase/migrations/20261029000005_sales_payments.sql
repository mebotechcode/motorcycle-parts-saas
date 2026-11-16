-- =====================================================================
-- Phase 1 / 05 — Cash sessions, sales, M-Pesa, payments, returns, customer ledger
-- Money rules:
--   sale_items.line_total = quantity * unit_price - discount_amount   (VAT-inclusive)
--   sales.subtotal        = sum(line_total)
--   sales.total           = subtotal - discount_total
--   sales.tax_total       = VAT portion contained in total
--   sales.amount_paid     = sum of payments (kept by trigger in Phase 2)
-- =====================================================================

create table public.cash_sessions (       -- a till shift / daily cash-up
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  branch_id        uuid not null,
  status           public.cash_session_status not null default 'open',
  opened_by        uuid not null default auth.uid(),
  opened_at        timestamptz not null default now(),
  opening_float    numeric(14,2) not null default 0,
  closed_by        uuid,
  closed_at        timestamptz,
  expected_cash    numeric(14,2),
  counted_cash     numeric(14,2),
  cash_variance    numeric(14,2),
  expected_mpesa   numeric(14,2),
  expected_bank    numeric(14,2),
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, branch_id) references public.branches (tenant_id, id)
);
create index on public.cash_sessions (tenant_id, branch_id, opened_at desc);
create unique index one_open_session_per_branch_user
  on public.cash_sessions (tenant_id, branch_id, opened_by) where status = 'open';

create table public.sales (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  branch_id        uuid not null,
  receipt_no       text,                                  -- assigned on completion
  customer_id      uuid,                                  -- null = walk-in
  cashier_id       uuid not null default auth.uid(),
  cash_session_id  uuid,
  status           public.sale_status not null default 'completed',
  price_tier       public.price_tier not null default 'retail',
  subtotal         numeric(14,2) not null default 0,
  discount_total   numeric(14,2) not null default 0 check (discount_total >= 0),
  tax_total        numeric(14,2) not null default 0,
  total            numeric(14,2) not null default 0 check (total >= 0),
  amount_paid      numeric(14,2) not null default 0 check (amount_paid >= 0),
  balance_due      numeric(14,2) generated always as (total - amount_paid) stored,
  notes            text,
  sold_at          timestamptz not null default now(),
  client_uuid      uuid,                                  -- offline idempotency key
  -- KRA eTIMS
  etims_status       public.etims_status not null default 'not_required',
  etims_invoice_no   text,
  etims_qr_url       text,
  etims_submitted_at timestamptz,
  etims_error        text,
  -- void
  voided_by        uuid,
  voided_at        timestamptz,
  void_reason      text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, client_uuid),
  unique (tenant_id, branch_id, receipt_no),
  check (status = 'held' or receipt_no is not null),
  foreign key (tenant_id, branch_id)       references public.branches (tenant_id, id),
  foreign key (tenant_id, customer_id)     references public.customers (tenant_id, id),
  foreign key (tenant_id, cash_session_id) references public.cash_sessions (tenant_id, id)
);
create index on public.sales (tenant_id, branch_id, sold_at desc);
create index on public.sales (tenant_id, customer_id) where customer_id is not null;
create index on public.sales (tenant_id, cashier_id, sold_at desc);
create index on public.sales (tenant_id, etims_status) where etims_status in ('pending','failed');

create table public.sale_items (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  sale_id         uuid not null,
  product_id      uuid not null,
  product_name    text not null,                          -- snapshot at time of sale
  sku             text not null,
  quantity        numeric(12,2) not null check (quantity > 0),
  unit_price      numeric(14,2) not null check (unit_price >= 0),
  unit_cost       numeric(14,2) not null default 0,       -- snapshot, for profit reports
  discount_amount numeric(14,2) not null default 0 check (discount_amount >= 0),
  tax_category    public.tax_category not null default 'standard',
  tax_rate        numeric(5,2) not null default 0,
  tax_amount      numeric(14,2) not null default 0,
  line_total      numeric(14,2) not null,
  returned_qty    numeric(12,2) not null default 0 check (returned_qty >= 0),
  unique (tenant_id, id),
  check (returned_qty <= quantity),
  foreign key (tenant_id, sale_id)    references public.sales (tenant_id, id) on delete cascade,
  foreign key (tenant_id, product_id) references public.products (tenant_id, id)
);
create index on public.sale_items (sale_id);
create index on public.sale_items (tenant_id, product_id);

-- M-Pesa transactions (STK Push requests and C2B Till/Paybill confirmations)
create table public.mpesa_transactions (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id) on delete cascade,
  branch_id           uuid,
  kind                public.mpesa_kind not null,
  status              public.mpesa_status not null default 'pending',
  shortcode           text,
  phone               text,
  amount              numeric(14,2) not null check (amount > 0),
  account_reference   text,                               -- BillRefNumber / our reference
  merchant_request_id text,
  checkout_request_id text unique,
  mpesa_receipt       text,                               -- e.g. 'SFK1A2B3C4'
  result_code         int,
  result_desc         text,
  sale_id             uuid,
  customer_id         uuid,
  initiated_by        uuid,
  transaction_time    timestamptz,
  raw_payload         jsonb,
  matched_at          timestamptz,                        -- null = unmatched C2B payment
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, branch_id)   references public.branches (tenant_id, id),
  foreign key (tenant_id, sale_id)     references public.sales (tenant_id, id),
  foreign key (tenant_id, customer_id) references public.customers (tenant_id, id)
);
-- Callbacks can be retried by Safaricom: the receipt code makes processing idempotent
create unique index mpesa_receipt_unique on public.mpesa_transactions (tenant_id, mpesa_receipt)
  where mpesa_receipt is not null;
create index on public.mpesa_transactions (tenant_id, status, created_at desc);
create index on public.mpesa_transactions (tenant_id, matched_at) where matched_at is null;

create table public.payments (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references public.tenants(id) on delete cascade,
  branch_id            uuid not null,
  kind                 public.payment_kind not null default 'sale_payment',
  sale_id              uuid,
  customer_id          uuid,
  method               public.payment_method not null,
  amount               numeric(14,2) not null check (amount > 0),
  reference            text,                              -- M-Pesa code, bank ref
  mpesa_transaction_id uuid,
  cash_session_id      uuid,
  received_by          uuid default auth.uid(),
  paid_at              timestamptz not null default now(),
  client_uuid          uuid,
  note                 text,
  created_at           timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, client_uuid),
  check (kind <> 'sale_payment'   or sale_id is not null),
  check (kind <> 'debt_repayment' or customer_id is not null),
  foreign key (tenant_id, branch_id)            references public.branches (tenant_id, id),
  foreign key (tenant_id, sale_id)              references public.sales (tenant_id, id),
  foreign key (tenant_id, customer_id)          references public.customers (tenant_id, id),
  foreign key (tenant_id, mpesa_transaction_id) references public.mpesa_transactions (tenant_id, id),
  foreign key (tenant_id, cash_session_id)      references public.cash_sessions (tenant_id, id)
);
create index on public.payments (tenant_id, sale_id);
create index on public.payments (tenant_id, customer_id);
create index on public.payments (tenant_id, branch_id, paid_at desc);
create index on public.payments (tenant_id, method, reference);

create table public.sale_returns (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  branch_id     uuid not null,
  sale_id       uuid not null,
  return_no     text not null,
  reason        text,
  refund_method public.refund_method not null default 'cash',
  total_refund  numeric(14,2) not null default 0 check (total_refund >= 0),
  processed_by  uuid default auth.uid(),
  created_at    timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, return_no),
  foreign key (tenant_id, branch_id) references public.branches (tenant_id, id),
  foreign key (tenant_id, sale_id)   references public.sales (tenant_id, id)
);
create index on public.sale_returns (tenant_id, sale_id);

create table public.sale_return_items (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  return_id    uuid not null,
  sale_item_id uuid not null,
  product_id   uuid not null,
  quantity     numeric(12,2) not null check (quantity > 0),
  unit_price   numeric(14,2) not null check (unit_price >= 0),
  line_total   numeric(14,2) not null,
  restock      boolean not null default true,             -- false for damaged items
  foreign key (tenant_id, return_id)    references public.sale_returns (tenant_id, id) on delete cascade,
  foreign key (tenant_id, sale_item_id) references public.sale_items (tenant_id, id),
  foreign key (tenant_id, product_id)   references public.products (tenant_id, id)
);
create index on public.sale_return_items (return_id);

-- Customer debt ledger: positive amount = customer owes more; negative = customer paid / credited
create table public.customer_ledger (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  customer_id uuid not null,
  branch_id   uuid,
  entry_type  public.ledger_entry_type not null,
  amount      numeric(14,2) not null check (amount <> 0),
  sale_id     uuid,
  payment_id  uuid,
  note        text,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  foreign key (tenant_id, customer_id) references public.customers (tenant_id, id),
  foreign key (tenant_id, branch_id)   references public.branches (tenant_id, id),
  foreign key (tenant_id, sale_id)     references public.sales (tenant_id, id),
  foreign key (tenant_id, payment_id)  references public.payments (tenant_id, id)
);
create index on public.customer_ledger (tenant_id, customer_id, created_at desc);

create view public.customer_balances with (security_invoker = true) as
  select tenant_id, customer_id, sum(amount) as balance, max(created_at) as last_activity
  from public.customer_ledger
  group by tenant_id, customer_id;
