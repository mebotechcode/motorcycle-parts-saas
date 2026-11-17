-- =====================================================================
-- Phase 8 / 27 — CSV import carries Kenyan fields
-- import_products() now passes shelf_location, aisle, rack, bin,
-- aliases (slang, ';' separated), hs_code and etims_code to save_product.
-- Blank cells keep the current value on update, so a partial sheet
-- never wipes existing locations or KRA codes.
-- =====================================================================

create or replace function public.import_products(
  p_rows            jsonb,
  p_branch_id       uuid    default null,
  p_update_existing boolean default false
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  r jsonb;
  x record;
  v_row      int;
  v_name     text;
  v_sku      text;
  v_grade    text;
  v_cat      uuid;
  v_brand    uuid;
  v_mid      uuid;
  v_models   uuid[];
  v_missing  text[];
  v_barcodes jsonb;
  v_aliases  jsonb;
  v_data     jsonb;
  v_ex       public.products;
  v_cost     public.product_costs;
  v_old_barcodes jsonb;
  v_old_models   jsonb;
  v_created int := 0;
  v_updated int := 0;
  v_skipped int := 0;
  v_failed  int := 0;
  v_errors   jsonb := '[]'::jsonb;
  v_warnings jsonb := '[]'::jsonb;
  v_max   int := private.tenant_max_products();
  v_count int;
begin
  if not private.has_role(array['owner','manager','storekeeper']) then
    raise exception 'Only the owner, managers and storekeepers can import products' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'No rows to import' using errcode = '22023';
  end if;

  select count(*) into v_count from public.products where deleted_at is null;
  perform set_config('app.bulk_import', 'on', true);   -- limit is checked below, once per batch

  for r in select * from jsonb_array_elements(p_rows) loop
    v_row := coalesce((r ->> '_row')::int, 0);
    begin
      v_name := btrim(coalesce(r ->> 'name', ''));
      v_sku  := nullif(btrim(coalesce(r ->> 'sku', '')), '');
      if v_name = '' then
        raise exception 'The product name is missing' using errcode = '22023';
      end if;

      v_ex := null;
      if v_sku is not null then
        select * into v_ex from public.products where sku = v_sku;
      end if;

      if v_ex.id is not null and not p_update_existing then
        v_skipped := v_skipped + 1;
        v_warnings := v_warnings || jsonb_build_object('row', v_row, 'message', 'Code ' || v_sku || ' already exists, skipped');
        continue;
      end if;

      if v_ex.id is null then
        if nullif(btrim(coalesce(r ->> 'selling_price', '')), '') is null then
          raise exception 'The selling price is missing' using errcode = '22023';
        end if;
        if v_max is not null and v_count + v_created >= v_max then
          raise exception 'Your plan allows % products. Please upgrade to add more.', v_max;
        end if;
      end if;

      -- category and brand: use the existing one with the same name, else create it
      v_cat := null;
      if nullif(btrim(coalesce(r ->> 'category', '')), '') is not null then
        select id into v_cat from public.product_categories
         where parent_id is null and lower(name) = lower(btrim(r ->> 'category'));
        if v_cat is null then
          insert into public.product_categories (name) values (btrim(r ->> 'category')) returning id into v_cat;
        end if;
      end if;
      v_brand := null;
      if nullif(btrim(coalesce(r ->> 'brand', '')), '') is not null then
        select id into v_brand from public.brands where lower(name) = lower(btrim(r ->> 'brand'));
        if v_brand is null then
          insert into public.brands (name) values (btrim(r ->> 'brand')) returning id into v_brand;
        end if;
      end if;

      -- quality
      v_grade := lower(coalesce(nullif(btrim(r ->> 'quality'), ''), 'aftermarket'));
      if v_grade not in ('genuine','oem','aftermarket','refurbished') then
        v_warnings := v_warnings || jsonb_build_object('row', v_row, 'message', 'Unknown quality "' || v_grade || '", used aftermarket');
        v_grade := 'aftermarket';
      end if;

      -- bike fit: "Make Model; Make Model" matched against bikes you already have
      v_models := '{}';
      v_missing := '{}';
      for x in
        select btrim(t) as t from unnest(string_to_array(coalesce(r ->> 'fits', ''), ';')) as t where btrim(t) <> ''
      loop
        v_mid := null;
        select bm.id into v_mid
          from public.bike_models bm join public.bike_makes bk on bk.id = bm.make_id
         where lower(bk.name || ' ' || bm.name) = lower(x.t) or lower(bm.name) = lower(x.t)
         limit 1;
        if v_mid is null then v_missing := v_missing || x.t; else v_models := v_models || v_mid; end if;
      end loop;
      if array_length(v_missing, 1) is not null then
        v_warnings := v_warnings || jsonb_build_object('row', v_row,
          'message', 'Bike not found (add it on the product page): ' || array_to_string(v_missing, ', '));
      end if;

      v_barcodes := case when nullif(btrim(coalesce(r ->> 'barcode', '')), '') is null then null
                         else to_jsonb(regexp_split_to_array(btrim(r ->> 'barcode'), '\s*[;,]\s*')) end;

      v_aliases := case when nullif(btrim(coalesce(r ->> 'aliases', '')), '') is null then null
                        else to_jsonb(regexp_split_to_array(lower(btrim(r ->> 'aliases')), '\s*;\s*')) end;

      if v_ex.id is null then
        v_data := jsonb_build_object(
          'name', v_name, 'sku', v_sku, 'part_number', r ->> 'part_number',
          'category_id', v_cat, 'brand_id', v_brand, 'quality_grade', v_grade,
          'unit', coalesce(nullif(r ->> 'unit', ''), 'pc'),
          'selling_price', r ->> 'selling_price', 'wholesale_price', r ->> 'wholesale_price',
          'cost_price', r ->> 'cost_price', 'min_selling_price', r ->> 'min_price',
          'reorder_level', r ->> 'reorder_level',
          'shelf_location', r ->> 'shelf_location',
          'aisle', r ->> 'aisle', 'rack', r ->> 'rack', 'bin', r ->> 'bin',
          'hs_code', r ->> 'hs_code', 'etims_code', r ->> 'etims_code',
          'aliases', coalesce(v_aliases, '[]'::jsonb),
          'barcodes', coalesce(v_barcodes, '[]'::jsonb),
          'bike_model_ids', to_jsonb(v_models),
          'opening_branch_id', p_branch_id, 'opening_qty', r ->> 'opening_stock');
        perform public.save_product(null, v_data);
        v_created := v_created + 1;
      else
        -- update: blank cells keep the current value
        select * into v_cost from public.product_costs where product_id = v_ex.id;
        select coalesce(jsonb_agg(barcode), '[]'::jsonb) into v_old_barcodes from public.product_barcodes where product_id = v_ex.id;
        select coalesce(jsonb_agg(bike_model_id), '[]'::jsonb) into v_old_models from public.product_compatibility where product_id = v_ex.id;
        v_data := jsonb_build_object(
          'name', v_name, 'sku', v_ex.sku,
          'part_number', coalesce(nullif(btrim(coalesce(r ->> 'part_number', '')), ''), v_ex.part_number),
          'description', v_ex.description,
          'category_id', coalesce(v_cat, v_ex.category_id),
          'brand_id', coalesce(v_brand, v_ex.brand_id),
          'quality_grade', case when nullif(btrim(coalesce(r ->> 'quality', '')), '') is null then v_ex.quality_grade::text else v_grade end,
          'unit', coalesce(nullif(r ->> 'unit', ''), v_ex.unit),
          'track_stock', v_ex.track_stock, 'is_active', v_ex.is_active,
          'tax_category', v_ex.tax_category::text,
          'shelf_location', coalesce(nullif(btrim(coalesce(r ->> 'shelf_location', '')), ''), v_ex.shelf_location),
          'aisle', coalesce(nullif(btrim(coalesce(r ->> 'aisle', '')), ''), v_ex.aisle),
          'rack', coalesce(nullif(btrim(coalesce(r ->> 'rack', '')), ''), v_ex.rack),
          'bin', coalesce(nullif(btrim(coalesce(r ->> 'bin', '')), ''), v_ex.bin),
          'hs_code', coalesce(nullif(btrim(coalesce(r ->> 'hs_code', '')), ''), v_ex.hs_code),
          'etims_code', coalesce(nullif(btrim(coalesce(r ->> 'etims_code', '')), ''), v_ex.etims_code),
          'aliases', coalesce(v_aliases, to_jsonb(v_ex.aliases)),
          'selling_price', coalesce(nullif(r ->> 'selling_price', '')::numeric, v_ex.selling_price),
          'wholesale_price', coalesce(nullif(r ->> 'wholesale_price', '')::numeric, v_ex.wholesale_price),
          'cost_price', coalesce(nullif(r ->> 'cost_price', '')::numeric, v_cost.cost_price, 0),
          'min_selling_price', coalesce(nullif(r ->> 'min_price', '')::numeric, v_cost.min_selling_price),
          'reorder_level', coalesce(nullif(r ->> 'reorder_level', '')::numeric, v_ex.reorder_level),
          'barcodes', coalesce(v_barcodes, v_old_barcodes),
          'bike_model_ids', case when array_length(v_models, 1) is null then v_old_models else to_jsonb(v_models) end);
        perform public.save_product(v_ex.id, v_data);
        v_updated := v_updated + 1;
        if nullif(btrim(coalesce(r ->> 'opening_stock', '')), '') is not null then
          v_warnings := v_warnings || jsonb_build_object('row', v_row, 'message', 'Stock column ignored for an existing product (use Stock count on the product page)');
        end if;
      end if;
    exception when others then
      v_failed := v_failed + 1;
      v_errors := v_errors || jsonb_build_object('row', v_row, 'message', sqlerrm);
    end;
  end loop;

  return jsonb_build_object('created', v_created, 'updated', v_updated, 'skipped', v_skipped,
                            'failed', v_failed, 'errors', v_errors, 'warnings', v_warnings);
end $$;


revoke execute on function public.import_products(jsonb, uuid, boolean) from public, anon;
grant  execute on function public.import_products(jsonb, uuid, boolean) to authenticated;
