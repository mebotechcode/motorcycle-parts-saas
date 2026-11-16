-- =====================================================================
-- Phase 1 / 07 — Expenses, SMS log, audit log
-- =====================================================================

create table public.expense_categories (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  name       text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, name)
);

create table public.expenses (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  branch_id       uuid not null,
  category_id     uuid,
  amount          numeric(14,2) not null check (amount > 0),
  method          public.payment_method not null default 'cash',
  reference       text,
  paid_to         text,
  description     text,
  incurred_on     date not null default current_date,
  cash_session_id uuid,
  created_by      uuid default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  foreign key (tenant_id, branch_id)       references public.branches (tenant_id, id),
  foreign key (tenant_id, category_id)     references public.expense_categories (tenant_id, id),
  foreign key (tenant_id, cash_session_id) references public.cash_sessions (tenant_id, id)
);
create index on public.expenses (tenant_id, branch_id, incurred_on desc);

create table public.sms_messages (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id) on delete cascade,
  customer_id         uuid,
  to_phone            text not null,
  body                text not null,
  template            text,                              -- e.g. 'debt_reminder', 'receipt'
  status              public.sms_status not null default 'queued',
  provider_message_id text,
  error               text,
  created_by          uuid default auth.uid(),
  created_at          timestamptz not null default now(),
  sent_at             timestamptz,
  foreign key (tenant_id, customer_id) references public.customers (tenant_id, id)
);
create index on public.sms_messages (tenant_id, created_at desc);
create index on public.sms_messages (tenant_id, status) where status = 'queued';

-- Append-only audit trail (filled by triggers in Phase 2: price changes,
-- deletes, voids, stock adjustments, role changes, discount overrides)
create table public.audit_logs (
  id         bigint generated always as identity primary key,
  tenant_id  uuid references public.tenants(id) on delete cascade,   -- null = platform-level event
  user_id    uuid,
  action     text not null,                  -- 'insert' | 'update' | 'delete' | custom e.g. 'price_change'
  table_name text not null,
  record_id  text,
  old_data   jsonb,
  new_data   jsonb,
  created_at timestamptz not null default now()
);
create index on public.audit_logs (tenant_id, created_at desc);
create index on public.audit_logs (tenant_id, table_name, record_id);
