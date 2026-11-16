-- =====================================================================
-- Phase 1 / 02 — Tenancy, staff, branches, subscriptions, integrations
-- Conventions used in every tenant-owned table:
--   * tenant_id uuid not null  (RLS key, added in Phase 2)
--   * unique (tenant_id, id)   so children can use composite FKs
--     (tenant_id, parent_id) -> parent (tenant_id, id). This makes it
--     impossible for a row to point at another tenant's data, even if
--     application code or RLS has a bug.
--   * user-attribution columns (created_by etc.) are plain uuids, not FKs,
--     so deleting a staff account never breaks history.
-- =====================================================================

-- ---------- Plans (platform-level, readable by all tenants) ----------
create table public.plans (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique,
  name          text not null,
  price_monthly numeric(12,2) not null default 0 check (price_monthly >= 0),
  price_yearly  numeric(12,2) not null default 0 check (price_yearly  >= 0),
  max_branches  int,            -- null = unlimited
  max_users     int,
  max_products  int,
  features      jsonb not null default '{}'::jsonb,   -- e.g. {"etims":true,"sms":true}
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ---------- Tenants (one per business) ----------
create table public.tenants (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  slug             text not null unique check (slug ~ '^[a-z0-9-]{3,40}$'),
  kra_pin          text,
  vat_registered   boolean not null default false,
  vat_rate         numeric(5,2) not null default 16.00,
  phone            text,
  email            text,
  address          text,
  town             text,
  logo_path        text,
  currency         char(3) not null default 'KES',
  default_language text not null default 'en' check (default_language in ('en','sw')),
  receipt_footer   text,
  status           public.tenant_status not null default 'active',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- ---------- Users ----------
create table public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  full_name  text,
  phone      text,
  language   text not null default 'en' check (language in ('en','sw')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.platform_admins (       -- SaaS super admins (you)
  user_id    uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- ---------- Branches ----------
create table public.branches (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  name       text not null,
  code       text not null,                 -- short code used in receipt numbers, e.g. 'NRB'
  phone      text,
  address    text,
  town       text,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, code)
);

-- ---------- Staff membership & branch access ----------
create table public.tenant_members (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  user_id          uuid not null references auth.users(id) on delete cascade,
  role             public.app_role not null,
  status           public.member_status not null default 'active',
  all_branches     boolean not null default true,   -- false => limited to member_branches
  max_discount_pct numeric(5,2) not null default 0 check (max_discount_pct between 0 and 100),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, user_id)
);
create index on public.tenant_members (user_id);

create table public.member_branches (
  tenant_id  uuid not null,
  member_id  uuid not null,
  branch_id  uuid not null,
  primary key (member_id, branch_id),
  foreign key (tenant_id, member_id) references public.tenant_members (tenant_id, id) on delete cascade,
  foreign key (tenant_id, branch_id) references public.branches (tenant_id, id) on delete cascade
);

create table public.tenant_invites (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  email      text not null,
  role       public.app_role not null,
  branch_ids uuid[] not null default '{}',
  token      uuid not null unique default gen_random_uuid(),
  invited_by uuid default auth.uid(),
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.tenant_invites (tenant_id);
create index on public.tenant_invites (lower(email));

-- ---------- Subscriptions & billing ----------
create table public.subscriptions (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null unique references public.tenants(id) on delete cascade,
  plan_id              uuid not null references public.plans(id),
  status               public.subscription_status not null default 'trialing',
  billing_cycle        text not null default 'monthly' check (billing_cycle in ('monthly','yearly')),
  trial_ends_at        timestamptz,
  current_period_start timestamptz,
  current_period_end   timestamptz,
  grace_ends_at        timestamptz,          -- after this, status -> suspended
  cancelled_at         timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create table public.subscription_invoices (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  subscription_id uuid not null references public.subscriptions(id) on delete cascade,
  plan_id         uuid not null references public.plans(id),
  period_start    date not null,
  period_end      date not null,
  amount          numeric(12,2) not null check (amount >= 0),
  status          public.invoice_status not null default 'open',
  due_date        date not null,
  paid_at         timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (tenant_id, id)
);
create index on public.subscription_invoices (tenant_id, status);

-- M-Pesa STK pushes made to charge tenants for their subscription
create table public.subscription_payments (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id) on delete cascade,
  invoice_id          uuid,
  phone               text not null,
  amount              numeric(12,2) not null check (amount > 0),
  merchant_request_id text,
  checkout_request_id text unique,
  mpesa_receipt       text unique,
  status              public.mpesa_status not null default 'pending',
  result_code         int,
  result_desc         text,
  raw_payload         jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  foreign key (tenant_id, invoice_id) references public.subscription_invoices (tenant_id, id)
);
create index on public.subscription_payments (tenant_id);

-- ---------- Integrations (secrets live in Supabase Vault, only ids here) ----------
create table public.tenant_integrations (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  provider   public.integration_provider not null,
  config     jsonb not null default '{}'::jsonb,       -- non-secret settings
  secret_ids jsonb not null default '{}'::jsonb,       -- {"consumer_key":"<vault uuid>", ...}
  is_active  boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, provider)
);

-- Routes incoming M-Pesa C2B callbacks to the right tenant by shortcode
create table public.tenant_mpesa_accounts (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  branch_id      uuid,                                  -- null = whole business
  shortcode      text not null unique,
  shortcode_type text not null check (shortcode_type in ('till','paybill')),
  environment    text not null default 'sandbox' check (environment in ('sandbox','production')),
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  foreign key (tenant_id, branch_id) references public.branches (tenant_id, id)
);
create index on public.tenant_mpesa_accounts (tenant_id);

-- ---------- Per-tenant document numbering (receipts, POs, transfers...) ----------
create table public.document_sequences (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  branch_id   uuid,
  doc_type    text not null check (doc_type in ('receipt','purchase_order','transfer','return')),
  last_number bigint not null default 0,
  updated_at  timestamptz not null default now(),
  foreign key (tenant_id, branch_id) references public.branches (tenant_id, id),
  unique nulls not distinct (tenant_id, branch_id, doc_type)
);
