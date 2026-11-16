-- =====================================================================
-- Phase 1 / 03 — Catalog (parts, brands, bike compatibility) & inventory
-- Prices are VAT-inclusive (normal for Kenyan retail).
-- =====================================================================

create table public.product_categories (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  parent_id  uuid,
  name       text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique nulls not distinct (tenant_id, parent_id, name),
  foreign key (tenant_id, parent_id) references public.product_categories (tenant_id, id)
);

create table public.brands (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  name       text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, name)
);

-- Bike makes/models: tenant_id NULL = global reference data maintained by the platform;
-- tenants may add their own (tenant_id set).
create table public.bike_makes (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid references public.tenants(id) on delete cascade,
  name       text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (tenant_id, name)
);

create table public.bike_models (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid references public.tenants(id) on delete cascade,
  make_id    uuid not null references public.bike_makes(id) on delete cascade,
  name       text not null,
  engine_cc  int,
  year_from  int,
  year_to    int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (tenant_id, make_id, name)
);
create index on public.bike_models (make_id);

create table public.products (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  sku               text not null,
  name              text not null,
  description       text,
  category_id       uuid,
  brand_id          uuid,
  quality_grade     public.quality_grade not null default 'aftermarket',
  part_number       text,                         -- manufacturer / OEM part number
  unit              text not null default 'pc',   -- pc, set, litre, pair, metre...
  track_stock       boolean not null default true,
  cost_price        numeric(14,2) not null default 0 check (cost_price >= 0),   -- latest buying price
  selling_price     numeric(14,2) not null default 0 check (selling_price >= 0),
  wholesale_price   numeric(14,2) check (wholesale_price >= 0),
  min_selling_price numeric(14,2) check (min_selling_price >= 0),               -- price floor
  tax_category      public.tax_category not null default 'standard',
  reorder_level     numeric(12,2) not null default 0 check (reorder_level >= 0),
  shelf_location    text,
  image_path        text,
  is_active         boolean not null default true,
  deleted_at        timestamptz,                  -- soft delete (needed for offline sync)
  created_by        uuid default auth.uid(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, sku),
  foreign key (tenant_id, category_id) references public.product_categories (tenant_id, id),
  foreign key (tenant_id, brand_id)    references public.brands (tenant_id, id),
  check (min_selling_price is null or min_selling_price <= selling_price)
);
create index on public.products (tenant_id, category_id);
create index on public.products (tenant_id, brand_id);
create index on public.products (tenant_id, updated_at);   -- offline delta sync
create index products_name_trgm on public.products using gin (name extensions.gin_trgm_ops);
create index products_part_no_trgm on public.products using gin (part_number extensions.gin_trgm_ops);

create table public.product_barcodes (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  product_id uuid not null,
  barcode    text not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, barcode),
  foreign key (tenant_id, product_id) references public.products (tenant_id, id) on delete cascade
);
create index on public.product_barcodes (product_id);

-- Which bike models a part fits (many-to-many)
create table public.product_compatibility (
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  product_id    uuid not null,
  bike_model_id uuid not null references public.bike_models(id) on delete cascade,
  notes         text,
  primary key (product_id, bike_model_id),
  foreign key (tenant_id, product_id) references public.products (tenant_id, id) on delete cascade
);
create index on public.product_compatibility (bike_model_id);
create index on public.product_compatibility (tenant_id);

-- ---------------------------------------------------------------------
-- Inventory
-- stock_levels is a cache maintained by a trigger on stock_movements
-- (Phase 2). stock_movements is the source of truth (append-only).
-- ---------------------------------------------------------------------
create table public.stock_levels (
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  branch_id     uuid not null,
  product_id    uuid not null,
  quantity      numeric(12,2) not null default 0,
  reorder_level numeric(12,2) check (reorder_level >= 0),   -- overrides products.reorder_level
  updated_at    timestamptz not null default now(),
  primary key (branch_id, product_id),
  foreign key (tenant_id, branch_id)  references public.branches (tenant_id, id) on delete cascade,
  foreign key (tenant_id, product_id) references public.products (tenant_id, id) on delete cascade
);
create index on public.stock_levels (tenant_id, product_id);

create table public.stock_movements (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  branch_id      uuid not null,
  product_id     uuid not null,
  movement_type  public.stock_movement_type not null,
  quantity       numeric(12,2) not null check (quantity <> 0),   -- signed: + in, - out
  unit_cost      numeric(14,2),
  balance_after  numeric(12,2),                                  -- set by trigger
  reference_type text,                                           -- 'sale','goods_receipt','transfer',...
  reference_id   uuid,
  reason         text,                                           -- required by app for adjustments/damage
  client_uuid    uuid,                                           -- offline idempotency
  created_by     uuid default auth.uid(),
  created_at     timestamptz not null default now(),
  unique (tenant_id, client_uuid),
  foreign key (tenant_id, branch_id)  references public.branches (tenant_id, id),
  foreign key (tenant_id, product_id) references public.products (tenant_id, id)
);
create index on public.stock_movements (tenant_id, branch_id, product_id, created_at desc);
create index on public.stock_movements (tenant_id, reference_type, reference_id);

create table public.stock_transfers (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  transfer_no    text not null,
  from_branch_id uuid not null,
  to_branch_id   uuid not null,
  status         public.transfer_status not null default 'draft',
  note           text,
  sent_by        uuid,
  sent_at        timestamptz,
  received_by    uuid,
  received_at    timestamptz,
  created_by     uuid default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, transfer_no),
  check (from_branch_id <> to_branch_id),
  foreign key (tenant_id, from_branch_id) references public.branches (tenant_id, id),
  foreign key (tenant_id, to_branch_id)   references public.branches (tenant_id, id)
);

create table public.stock_transfer_items (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  transfer_id  uuid not null,
  product_id   uuid not null,
  qty_sent     numeric(12,2) not null check (qty_sent > 0),
  qty_received numeric(12,2) not null default 0 check (qty_received >= 0),
  foreign key (tenant_id, transfer_id) references public.stock_transfers (tenant_id, id) on delete cascade,
  foreign key (tenant_id, product_id)  references public.products (tenant_id, id)
);
create index on public.stock_transfer_items (transfer_id);
