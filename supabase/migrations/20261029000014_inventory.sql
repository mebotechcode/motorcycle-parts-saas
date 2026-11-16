-- =====================================================================
-- Phase 4a / 14 — Inventory
--   * buying price + lowest price move to product_costs (hidden from cashiers)
--   * stock rules: users may only record opening stock, count corrections,
--     and damage/loss directly (purchases/sales/transfers come from their own flows)
--   * product_overview view (list screen: totals, low-stock, bike fit)
--   * save_product(): create/update a product in ONE safe step
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Private costs table: owner / manager / storekeeper only
-- ---------------------------------------------------------------------
create table public.product_costs (
  tenant_id         uuid not null default private.tenant_id() references public.tenants(id) on delete cascade,
  product_id        uuid primary key,
  cost_price        numeric(14,2) not null default 0 check (cost_price >= 0),
  min_selling_price numeric(14,2) check (min_selling_price >= 0),
  updated_by        uuid default auth.uid(),
  updated_at        timestamptz not null default now(),
  foreign key (tenant_id, product_id) references public.products (tenant_id, id) on delete cascade
);
create index on public.product_costs (tenant_id);

insert into public.product_costs (tenant_id, product_id, cost_price, min_selling_price)
select tenant_id, id, cost_price, min_selling_price from public.products;

drop trigger if exists audit_products_update on public.products;
alter table public.products drop column cost_price, drop column min_selling_price;

alter table public.product_costs enable row level security;
select private.set_policies('product_costs',
  array['owner','manager','storekeeper'], array['owner','manager','storekeeper'],
  array['owner','manager','storekeeper'], array['owner','manager']);
create policy product_costs_platform_read on public.product_costs for select to authenticated
  using ((select private.is_platform_admin()));
grant select, insert, update, delete on public.product_costs to authenticated;
grant all on public.product_costs to service_role;

create trigger trg_set_updated_at before update on public.product_costs
  for each row execute function public.set_updated_at();

-- audit: let the audit function also record rows keyed by product_id
create or replace function private.audit_row()
returns trigger language plpgsql security definer set search_path = '' as $$
declare r jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
begin
  insert into public.audit_logs (tenant_id, user_id, action, table_name, record_id, old_data, new_data)
  values ((r ->> 'tenant_id')::uuid, auth.uid(), lower(tg_op), tg_table_name,
          coalesce(r ->> 'id', r ->> 'product_id'),
          case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
          case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end);
  return null;
end $$;

create trigger audit_products_update after update on public.products
  for each row when (old.selling_price is distinct from new.selling_price
                  or old.wholesale_price is distinct from new.wholesale_price
                  or old.is_active is distinct from new.is_active
                  or old.deleted_at is distinct from new.deleted_at)
  execute function private.audit_row();
create trigger audit_product_costs_update after update on public.product_costs
  for each row when (old.cost_price is distinct from new.cost_price
                  or old.min_selling_price is distinct from new.min_selling_price)
  execute function private.audit_row();

-- ---------------------------------------------------------------------
-- 2. Storekeepers may also remove barcodes / bike-fit rows when editing a product
-- ---------------------------------------------------------------------
drop policy if exists product_barcodes_delete on public.product_barcodes;
create policy product_barcodes_delete on public.product_barcodes for delete to authenticated
  using (tenant_id = (select private.tenant_id()) and (select private.tenant_writable())
         and (select private.has_role(array['owner','manager','storekeeper'])));

drop policy if exists product_compatibility_delete on public.product_compatibility;
create policy product_compatibility_delete on public.product_compatibility for delete to authenticated
  using (tenant_id = (select private.tenant_id()) and (select private.tenant_writable())
         and (select private.has_role(array['owner','manager','storekeeper'])));

-- ---------------------------------------------------------------------
-- 3. Stock movement rules
--    Direct recording by staff: opening stock, count corrections, damage/loss.
--    Purchases, sales, returns and transfers are written by their own flows.
-- ---------------------------------------------------------------------
drop policy if exists stock_movements_insert on public.stock_movements;
create policy stock_movements_insert on public.stock_movements for insert to authenticated
  with check (tenant_id = (select private.tenant_id())
              and private.can_access_branch(branch_id)
              and (select private.tenant_writable())
              and (select private.has_role(array['owner','manager','storekeeper']))
              and movement_type in ('opening','adjustment','damage'));

alter table public.stock_movements
  add constraint stock_movement_reason_required
    check (movement_type not in ('adjustment','damage') or length(btrim(coalesce(reason, ''))) > 0),
  add constraint stock_movement_sign
    check (movement_type not in ('damage','opening')
           or (movement_type = 'damage' and quantity < 0)
           or (movement_type = 'opening' and quantity > 0));

-- ---------------------------------------------------------------------
-- 4. Product list view (runs with the caller's permissions, so a
--    branch-limited user sees stock totals for their branches only)
-- ---------------------------------------------------------------------
create or replace view public.product_overview with (security_invoker = true) as
select p.id, p.tenant_id, p.sku, p.name, p.description,
       p.category_id, c.name as category_name,
       p.brand_id, b.name as brand_name,
       p.quality_grade, p.part_number, p.unit, p.track_stock,
       p.selling_price, p.wholesale_price, p.tax_category,
       p.reorder_level, p.shelf_location, p.image_path,
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

grant select on public.product_overview to authenticated;
grant all on public.product_overview to service_role;

-- ---------------------------------------------------------------------
-- 5. save_product: create or update a product, its costs, barcodes,
--    bike fit and (for new products) opening stock — all or nothing.
--    Runs with the CALLER's permissions, so security rules still apply.
-- ---------------------------------------------------------------------
create or replace function public.save_product(p_id uuid, p_data jsonb)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_id      uuid := p_id;
  v_name    text := btrim(coalesce(p_data ->> 'name', ''));
  v_sku     text := nullif(btrim(coalesce(p_data ->> 'sku', '')), '');
  v_part    text := nullif(btrim(coalesce(p_data ->> 'part_number', '')), '');
  v_desc    text := nullif(btrim(coalesce(p_data ->> 'description', '')), '');
  v_shelf   text := nullif(btrim(coalesce(p_data ->> 'shelf_location', '')), '');
  v_cat     uuid := nullif(p_data ->> 'category_id', '')::uuid;
  v_brand   uuid := nullif(p_data ->> 'brand_id', '')::uuid;
  v_grade   public.quality_grade := coalesce(nullif(p_data ->> 'quality_grade', '')::public.quality_grade, 'aftermarket');
  v_tax     public.tax_category := coalesce(nullif(p_data ->> 'tax_category', '')::public.tax_category, 'standard');
  v_unit    text := coalesce(nullif(p_data ->> 'unit', ''), 'pc');
  v_track   boolean := coalesce((p_data ->> 'track_stock')::boolean, true);
  v_active  boolean := coalesce((p_data ->> 'is_active')::boolean, true);
  v_sell    numeric := coalesce(nullif(p_data ->> 'selling_price', '')::numeric, 0);
  v_whole   numeric := nullif(p_data ->> 'wholesale_price', '')::numeric;
  v_cost    numeric := coalesce(nullif(p_data ->> 'cost_price', '')::numeric, 0);
  v_min     numeric := nullif(p_data ->> 'min_selling_price', '')::numeric;
  v_reorder numeric := coalesce(nullif(p_data ->> 'reorder_level', '')::numeric, 0);
  v_barcodes text[];
  v_models   uuid[];
  v_open_branch uuid := nullif(p_data ->> 'opening_branch_id', '')::uuid;
  v_open_qty    numeric := coalesce(nullif(p_data ->> 'opening_qty', '')::numeric, 0);
begin
  if length(v_name) < 2 then
    raise exception 'Please enter the product name' using errcode = '22023';
  end if;
  if v_sell < 0 or v_cost < 0 or coalesce(v_whole, 0) < 0 or coalesce(v_min, 0) < 0 or v_reorder < 0 then
    raise exception 'Prices and quantities cannot be negative' using errcode = '22023';
  end if;
  if v_min is not null and v_min > v_sell then
    raise exception 'The lowest allowed price cannot be higher than the selling price' using errcode = '22023';
  end if;
  if v_whole is not null and v_whole > v_sell then
    raise exception 'The wholesale price cannot be higher than the retail price' using errcode = '22023';
  end if;

  -- product code: generate one if left empty
  if v_sku is null then
    loop
      v_sku := 'P-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
      exit when not exists (select 1 from public.products x where x.sku = v_sku);
    end loop;
  end if;
  if exists (select 1 from public.products x where x.sku = v_sku and (v_id is null or x.id <> v_id)) then
    raise exception 'Another product already uses the code "%"', v_sku using errcode = '23505';
  end if;

  select coalesce(array_agg(distinct btrim(b)), '{}') into v_barcodes
    from jsonb_array_elements_text(coalesce(p_data -> 'barcodes', '[]'::jsonb)) as b
   where btrim(b) <> '';
  if exists (select 1 from public.product_barcodes pb
              where pb.barcode = any (v_barcodes) and (v_id is null or pb.product_id <> v_id)) then
    raise exception 'One of the barcodes is already used by another product' using errcode = '23505';
  end if;

  select coalesce(array_agg(distinct m::uuid), '{}') into v_models
    from jsonb_array_elements_text(coalesce(p_data -> 'bike_model_ids', '[]'::jsonb)) as m;

  if v_id is null then
    insert into public.products
      (sku, name, description, category_id, brand_id, quality_grade, part_number, unit, track_stock,
       selling_price, wholesale_price, tax_category, reorder_level, shelf_location, is_active)
    values
      (v_sku, v_name, v_desc, v_cat, v_brand, v_grade, v_part, v_unit, v_track,
       v_sell, v_whole, v_tax, v_reorder, v_shelf, v_active)
    returning id into v_id;
  else
    update public.products
       set sku = v_sku, name = v_name, description = v_desc, category_id = v_cat, brand_id = v_brand,
           quality_grade = v_grade, part_number = v_part, unit = v_unit, track_stock = v_track,
           selling_price = v_sell, wholesale_price = v_whole, tax_category = v_tax,
           reorder_level = v_reorder, shelf_location = v_shelf, is_active = v_active
     where id = v_id;
    if not found then
      raise exception 'Product not found' using errcode = 'P0002';
    end if;
  end if;

  insert into public.product_costs (product_id, cost_price, min_selling_price)
  values (v_id, v_cost, v_min)
  on conflict (product_id) do update
     set cost_price = excluded.cost_price,
         min_selling_price = excluded.min_selling_price,
         updated_by = auth.uid();

  delete from public.product_barcodes where product_id = v_id;
  insert into public.product_barcodes (product_id, barcode)
  select v_id, x from unnest(v_barcodes) as x;

  delete from public.product_compatibility where product_id = v_id;
  insert into public.product_compatibility (product_id, bike_model_id)
  select v_id, x from unnest(v_models) as x;

  if p_id is null and v_open_branch is not null and v_open_qty > 0 and v_track then
    insert into public.stock_movements (branch_id, product_id, movement_type, quantity, unit_cost, reason)
    values (v_open_branch, v_id, 'opening', v_open_qty, v_cost, 'Opening stock');
  end if;

  return v_id;
end $$;

revoke execute on function public.save_product(uuid, jsonb) from public, anon;
grant  execute on function public.save_product(uuid, jsonb) to authenticated;
