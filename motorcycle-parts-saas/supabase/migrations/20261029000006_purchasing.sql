-- =====================================================================
-- Phase 1 / 06 — Purchasing, goods received, supplier ledger
-- =====================================================================

create table public.purchase_orders (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  branch_id     uuid not null,
  supplier_id   uuid not null,
  po_number     text not null,
  status        public.po_status not null default 'draft',
  order_date    date not null default current_date,
  expected_date date,
  notes         text,
  total         numeric(14,2) not null default 0,
  created_by    uuid default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, po_number),
  foreign key (tenant_id, branch_id)   references public.branches (tenant_id, id),
  foreign key (tenant_id, supplier_id) references public.suppliers (tenant_id, id)
);
create index on public.purchase_orders (tenant_id, supplier_id);

create table public.purchase_order_items (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  po_id        uuid not null,
  product_id   uuid not null,
  qty_ordered  numeric(12,2) not null check (qty_ordered > 0),
  qty_received numeric(12,2) not null default 0 check (qty_received >= 0),
  unit_cost    numeric(14,2) not null check (unit_cost >= 0),
  foreign key (tenant_id, po_id)      references public.purchase_orders (tenant_id, id) on delete cascade,
  foreign key (tenant_id, product_id) references public.products (tenant_id, id)
);
create index on public.purchase_order_items (po_id);

create table public.goods_receipts (       -- stock coming in (with or without a PO)
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id) on delete cascade,
  branch_id           uuid not null,
  supplier_id         uuid not null,
  po_id               uuid,
  supplier_invoice_no text,
  received_at         timestamptz not null default now(),
  received_by         uuid default auth.uid(),
  total               numeric(14,2) not null default 0,
  amount_paid         numeric(14,2) not null default 0,   -- paid at the time of receiving
  notes               text,
  created_at          timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, branch_id)   references public.branches (tenant_id, id),
  foreign key (tenant_id, supplier_id) references public.suppliers (tenant_id, id),
  foreign key (tenant_id, po_id)       references public.purchase_orders (tenant_id, id)
);
create index on public.goods_receipts (tenant_id, supplier_id, received_at desc);

create table public.goods_receipt_items (   -- also serves as supplier price history
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  receipt_id uuid not null,
  product_id uuid not null,
  quantity   numeric(12,2) not null check (quantity > 0),
  unit_cost  numeric(14,2) not null check (unit_cost >= 0),
  foreign key (tenant_id, receipt_id) references public.goods_receipts (tenant_id, id) on delete cascade,
  foreign key (tenant_id, product_id) references public.products (tenant_id, id)
);
create index on public.goods_receipt_items (receipt_id);
create index on public.goods_receipt_items (tenant_id, product_id);

create table public.supplier_payments (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  branch_id   uuid,
  supplier_id uuid not null,
  method      public.payment_method not null,
  amount      numeric(14,2) not null check (amount > 0),
  reference   text,
  paid_at     timestamptz not null default now(),
  paid_by     uuid default auth.uid(),
  note        text,
  created_at  timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, branch_id)   references public.branches (tenant_id, id),
  foreign key (tenant_id, supplier_id) references public.suppliers (tenant_id, id)
);
create index on public.supplier_payments (tenant_id, supplier_id);

-- Supplier ledger: positive = we owe the supplier more; negative = we paid
create table public.supplier_ledger (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  supplier_id uuid not null,
  entry_type  public.ledger_entry_type not null,
  amount      numeric(14,2) not null check (amount <> 0),
  receipt_id  uuid,
  payment_id  uuid,
  note        text,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  foreign key (tenant_id, supplier_id) references public.suppliers (tenant_id, id),
  foreign key (tenant_id, receipt_id)  references public.goods_receipts (tenant_id, id),
  foreign key (tenant_id, payment_id)  references public.supplier_payments (tenant_id, id)
);
create index on public.supplier_ledger (tenant_id, supplier_id, created_at desc);

create view public.supplier_balances with (security_invoker = true) as
  select tenant_id, supplier_id, sum(amount) as balance, max(created_at) as last_activity
  from public.supplier_ledger
  group by tenant_id, supplier_id;
