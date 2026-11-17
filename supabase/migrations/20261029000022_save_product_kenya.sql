-- =====================================================================
-- Phase 8 / 22 — save_product extended for Kenyan fields
-- aliases (slang search), aisle/rack/bin (POS location), HS / eTIMS codes.
-- CREATE OR REPLACE keeps the same signature and permissions.
-- =====================================================================

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
  v_aisle   text := nullif(btrim(coalesce(p_data ->> 'aisle', '')), '');
  v_rack    text := nullif(btrim(coalesce(p_data ->> 'rack', '')), '');
  v_bin     text := nullif(btrim(coalesce(p_data ->> 'bin', '')), '');
  v_hs      text := nullif(btrim(coalesce(p_data ->> 'hs_code', '')), '');
  v_etims   text := nullif(btrim(coalesce(p_data ->> 'etims_code', '')), '');
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
  v_aliases  text[];
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

  select coalesce(array_agg(distinct lower(btrim(a))), '{}') into v_aliases
    from jsonb_array_elements_text(coalesce(p_data -> 'aliases', '[]'::jsonb)) as a
   where btrim(a) <> '';

  if v_id is null then
    insert into public.products
      (sku, name, description, category_id, brand_id, quality_grade, part_number, unit, track_stock,
       selling_price, wholesale_price, tax_category, reorder_level, shelf_location, is_active,
       aliases, aisle, rack, bin, hs_code, etims_code)
    values
      (v_sku, v_name, v_desc, v_cat, v_brand, v_grade, v_part, v_unit, v_track,
       v_sell, v_whole, v_tax, v_reorder, v_shelf, v_active,
       v_aliases, v_aisle, v_rack, v_bin, v_hs, v_etims)
    returning id into v_id;
  else
    update public.products
       set sku = v_sku, name = v_name, description = v_desc, category_id = v_cat, brand_id = v_brand,
           quality_grade = v_grade, part_number = v_part, unit = v_unit, track_stock = v_track,
           selling_price = v_sell, wholesale_price = v_whole, tax_category = v_tax,
           reorder_level = v_reorder, shelf_location = v_shelf, is_active = v_active,
           aliases = v_aliases, aisle = v_aisle, rack = v_rack, bin = v_bin, hs_code = v_hs, etims_code = v_etims
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
