-- =====================================================================
-- Phase 1 / 04 — Customers and suppliers
-- (ledgers are created in 05 / 06, after sales and purchasing tables exist)
-- Phone numbers should be stored normalised to E.164, e.g. +254712345678.
-- =====================================================================

create table public.customers (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  name          text not null,
  phone         text,
  alt_phone     text,
  customer_type public.customer_type not null default 'retail',
  price_tier    public.price_tier not null default 'retail',
  kra_pin       text,
  address       text,
  credit_limit  numeric(14,2) not null default 0 check (credit_limit >= 0),   -- 0 = no credit
  notes         text,
  is_active     boolean not null default true,
  deleted_at    timestamptz,
  created_by    uuid default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (tenant_id, id)
);
create index on public.customers (tenant_id, phone);
create index on public.customers (tenant_id, updated_at);   -- offline delta sync
create index customers_name_trgm on public.customers using gin (name extensions.gin_trgm_ops);

create table public.suppliers (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants(id) on delete cascade,
  name               text not null,
  contact_person     text,
  phone              text,
  email              text,
  address            text,
  kra_pin            text,
  payment_terms_days int not null default 0 check (payment_terms_days >= 0),
  notes              text,
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (tenant_id, id)
);
create index on public.suppliers (tenant_id);
