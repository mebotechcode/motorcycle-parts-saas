-- =====================================================================
-- Phase 4b / 15 — Stock transfers between branches, CSV import, product limit
--   send_transfer()    : takes stock out of the sending branch (status in transit)
--   receive_transfer() : adds stock to the receiving branch (short deliveries recorded)
--   cancel_transfer()  : puts the stock back at the sender
--   import_products()  : bulk create/update products from a spreadsheet (CSV)
--   plan limit on the number of products
-- Run migration 14 first.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Plan limit on products
-- ---------------------------------------------------------------------
create or replace function private.tenant_max_products()
returns int language sql stable security definer set search_path = ''
as $$
  select p.max_products
    from public.subscriptions s join public.plans p on p.id = s.plan_id
   where s.tenant_id = private.tenant_id()
$$;
grant execute on function private.tenant_max_products() to authenticated;

create or replace function private.enforce_product_limit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_max int; v_count int;
begin
  -- bulk import checks the limit once per batch instead of once per row
  if current_setting('app.bulk_import', true) = 'on' then
    return new;
  end if;
  select p.max_products into v_max
    from public.subscriptions s join public.plans p on p.id = s.plan_id
   where s.tenant_id = new.tenant_id;
  if v_max is not null then
    select count(*) into v_count from public.products x
     where x.tenant_id = new.tenant_id and x.deleted_at is null;
    if v_count >= v_max then
      raise exception 'Your plan allows % products. Please upgrade to add more.', v_max;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_product_limit on public.products;
create trigger trg_product_limit before insert on public.products
  for each row execute function private.enforce_product_limit();

-- ---------------------------------------------------------------------
-- 2. Transfers are changed ONLY through the functions below
-- ---------------------------------------------------------------------
revoke insert, update, delete on public.stock_transfers, public.stock_transfer_items from authenticated;

create or replace function public.send_transfer(
  p_from  uuid,
  p_to    uuid,
  p_items jsonb,
  p_note  text default null
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_tenant  uuid := private.tenant_id();
  v_no      text;
  v_id      uuid;
  v_to_name text;
  v_name    text;
  v_have    numeric;
  it        record;
begin
  if v_tenant is null or not private.has_role(array['owner','manager','storekeeper']) then
    raise exception 'Only the owner, managers and storekeepers can transfer stock' using errcode = '42501';
  end if;
  if not private.tenant_writable() then
    raise exception 'Your subscription is not active' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_from = p_to then
    raise exception 'Choose two different branches' using errcode = '22023';
  end if;
  if not private.can_access_branch(p_from) then
    raise exception 'You cannot send stock from that branch' using errcode = '42501';
  end if;
  if not exists (select 1 from public.branches b where b.id = p_from and b.tenant_id = v_tenant) then
    raise exception 'Sending branch not found' using errcode = '22023';
  end if;
  select b.name into v_to_name from public.branches b
   where b.id = p_to and b.tenant_id = v_tenant and b.is_active;
  if v_to_name is null then
    raise exception 'Receiving branch not found' using errcode = '22023';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Add at least one item to transfer' using errcode = '22023';
  end if;

  v_no := public.next_document_number('transfer', null);

  insert into public.stock_transfers
    (tenant_id, transfer_no, from_branch_id, to_branch_id, status, note, sent_by, sent_at, created_by)
  values
    (v_tenant, v_no, p_from, p_to, 'in_transit', nullif(btrim(coalesce(p_note, '')), ''), auth.uid(), now(), auth.uid())
  returning id into v_id;

  for it in
    select (x ->> 'product_id')::uuid as product_id, sum((x ->> 'qty')::numeric) as qty
      from jsonb_array_elements(p_items) as x
     group by 1
  loop
    if it.qty is null or it.qty <= 0 then
      raise exception 'Quantities must be more than zero' using errcode = '22023';
    end if;

    v_name := null;
    select p.name into v_name from public.products p
     where p.id = it.product_id and p.tenant_id = v_tenant and p.track_stock;
    if v_name is null then
      raise exception 'A selected product was not found or is not stock-counted' using errcode = '22023';
    end if;

    v_have := coalesce((select sl.quantity from public.stock_levels sl
                         where sl.branch_id = p_from and sl.product_id = it.product_id), 0);
    if v_have < it.qty then
      raise exception 'Not enough "%" at the sending branch (it has %)', v_name, v_have using errcode = '22023';
    end if;

    insert into public.stock_transfer_items (tenant_id, transfer_id, product_id, qty_sent)
    values (v_tenant, v_id, it.product_id, it.qty);

    insert into public.stock_movements
      (tenant_id, branch_id, product_id, movement_type, quantity, reference_type, reference_id, reason, created_by)
    values
      (v_tenant, p_from, it.product_id, 'transfer_out', -it.qty, 'transfer', v_id,
       'Transfer ' || v_no || ' to ' || v_to_name, auth.uid());
  end loop;

  return v_id;
end $$;

create or replace function public.receive_transfer(p_transfer_id uuid, p_received jsonb default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_tenant uuid := private.tenant_id();
  t        public.stock_transfers;
  it       record;
  v_recv   numeric;
begin
  if v_tenant is null or not private.has_role(array['owner','manager','storekeeper']) then
    raise exception 'Only the owner, managers and storekeepers can receive stock' using errcode = '42501';
  end if;
  if not private.tenant_writable() then
    raise exception 'Your subscription is not active' using errcode = '42501';
  end if;

  select * into t from public.stock_transfers
   where id = p_transfer_id and tenant_id = v_tenant for update;
  if t.id is null then
    raise exception 'Transfer not found' using errcode = 'P0002';
  end if;
  if t.status <> 'in_transit' then
    raise exception 'This transfer is already %', t.status;
  end if;
  if not private.can_access_branch(t.to_branch_id) then
    raise exception 'Only staff of the receiving branch can receive this transfer' using errcode = '42501';
  end if;

  for it in select * from public.stock_transfer_items where transfer_id = t.id loop
    v_recv := it.qty_sent;
    if p_received is not null then
      select (x ->> 'qty')::numeric into v_recv
        from jsonb_array_elements(p_received) as x
       where (x ->> 'item_id')::uuid = it.id
       limit 1;
      v_recv := coalesce(v_recv, it.qty_sent);
    end if;
    if v_recv < 0 or v_recv > it.qty_sent then
      raise exception 'Received quantity must be between 0 and the quantity sent' using errcode = '22023';
    end if;

    update public.stock_transfer_items set qty_received = v_recv where id = it.id;

    insert into public.stock_movements
      (tenant_id, branch_id, product_id, movement_type, quantity, reference_type, reference_id, reason, created_by)
    values
      (v_tenant, t.to_branch_id, it.product_id, 'transfer_in', it.qty_sent, 'transfer', t.id,
       'Transfer ' || t.transfer_no || ' received', auth.uid());

    -- fewer items arrived than were sent: record the shortage as lost
    if v_recv < it.qty_sent then
      insert into public.stock_movements
        (tenant_id, branch_id, product_id, movement_type, quantity, reference_type, reference_id, reason, created_by)
      values
        (v_tenant, t.to_branch_id, it.product_id, 'damage', -(it.qty_sent - v_recv), 'transfer', t.id,
         'Short delivery on ' || t.transfer_no || ': sent ' || it.qty_sent || ', received ' || v_recv, auth.uid());
    end if;
  end loop;

  update public.stock_transfers
     set status = 'received', received_by = auth.uid(), received_at = now()
   where id = t.id;
end $$;

create or replace function public.cancel_transfer(p_transfer_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_tenant uuid := private.tenant_id();
  t        public.stock_transfers;
  it       record;
begin
  if v_tenant is null or not private.has_role(array['owner','manager','storekeeper']) then
    raise exception 'Only the owner, managers and storekeepers can cancel a transfer' using errcode = '42501';
  end if;
  if not private.tenant_writable() then
    raise exception 'Your subscription is not active' using errcode = '42501';
  end if;

  select * into t from public.stock_transfers
   where id = p_transfer_id and tenant_id = v_tenant for update;
  if t.id is null then
    raise exception 'Transfer not found' using errcode = 'P0002';
  end if;
  if t.status <> 'in_transit' then
    raise exception 'Only a transfer that is on its way can be cancelled (this one is %)', t.status;
  end if;
  if not private.can_access_branch(t.from_branch_id) then
    raise exception 'Only staff of the sending branch can cancel this transfer' using errcode = '42501';
  end if;

  for it in select * from public.stock_transfer_items where transfer_id = t.id loop
    insert into public.stock_movements
      (tenant_id, branch_id, product_id, movement_type, quantity, reference_type, reference_id, reason, created_by)
    values
      (v_tenant, t.from_branch_id, it.product_id, 'transfer_in', it.qty_sent, 'transfer', t.id,
       'Transfer ' || t.transfer_no || ' cancelled', auth.uid());
  end loop;

  update public.stock_transfers set status = 'cancelled' where id = t.id;
end $$;

-- ---------------------------------------------------------------------
-- 3. Bulk import (CSV rows sent in batches by the app)
--    Runs with the caller's permissions. A bad row never stops the others.
-- ---------------------------------------------------------------------
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

      if v_ex.id is null then
        v_data := jsonb_build_object(
          'name', v_name, 'sku', v_sku, 'part_number', r ->> 'part_number',
          'category_id', v_cat, 'brand_id', v_brand, 'quality_grade', v_grade,
          'unit', coalesce(nullif(r ->> 'unit', ''), 'pc'),
          'selling_price', r ->> 'selling_price', 'wholesale_price', r ->> 'wholesale_price',
          'cost_price', r ->> 'cost_price', 'min_selling_price', r ->> 'min_price',
          'reorder_level', r ->> 'reorder_level',
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
          'tax_category', v_ex.tax_category::text, 'shelf_location', v_ex.shelf_location,
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

-- ---------------------------------------------------------------------
-- 4. Who may call what
-- ---------------------------------------------------------------------
revoke execute on function public.send_transfer(uuid, uuid, jsonb, text) from public, anon;
revoke execute on function public.receive_transfer(uuid, jsonb) from public, anon;
revoke execute on function public.cancel_transfer(uuid) from public, anon;
revoke execute on function public.import_products(jsonb, uuid, boolean) from public, anon;
grant execute on function public.send_transfer(uuid, uuid, jsonb, text) to authenticated;
grant execute on function public.receive_transfer(uuid, jsonb) to authenticated;
grant execute on function public.cancel_transfer(uuid) to authenticated;
grant execute on function public.import_products(jsonb, uuid, boolean) to authenticated;
