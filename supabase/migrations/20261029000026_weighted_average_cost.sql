-- =====================================================================
-- Phase 8 / 26 — weighted-average costing on goods receipt
-- receive_goods() now blends the receipt into the stock value instead
-- of blindly overwriting the buying price with the latest invoice price:
--   new_avg = (stock_before * old_avg + received_qty * receipt_cost) / (stock_before + received_qty)
-- Applies tenant-wide (product_costs is per product). When there was no
-- prior stock or no prior cost, the receipt price is used.
-- =====================================================================

create or replace function public.receive_goods(p_data jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_tenant   uuid := private.tenant_id();
  v_user     uuid := auth.uid();
  v_supplier uuid := nullif(p_data ->> 'supplier_id', '')::uuid;
  v_branch   uuid := nullif(p_data ->> 'branch_id', '')::uuid;
  v_po       uuid := nullif(p_data ->> 'po_id', '')::uuid;
  v_client   uuid := nullif(p_data ->> 'client_uuid', '')::uuid;
  v_invoice  text := nullif(btrim(coalesce(p_data ->> 'supplier_invoice_no', '')), '');
  v_notes    text := nullif(btrim(coalesce(p_data ->> 'notes', '')), '');
  v_at       timestamptz := coalesce(nullif(p_data ->> 'received_at', '')::timestamptz, now());
  v_pay      jsonb := p_data -> 'payment';
  v_method   text;
  v_pref     text;
  v_paid     numeric := 0;
  v_total    numeric := 0;
  v_qty numeric; v_cost numeric;
  v_items jsonb := '[]'::jsonb;
  v_existing public.goods_receipts;
  po public.purchase_orders;
  pr public.products;
  e record;
  v_receipt uuid; v_pay_id uuid; v_poi uuid; v_done boolean;
begin
  if v_tenant is null or not private.has_role(array['owner','manager','storekeeper']) then
    raise exception 'You are not allowed to receive goods' using errcode = '42501';
  end if;
  if not private.tenant_writable() then
    raise exception 'Your subscription is not active' using errcode = '42501';
  end if;
  if v_branch is null or not private.can_access_branch(v_branch)
     or not exists (select 1 from public.branches b where b.id = v_branch and b.tenant_id = v_tenant) then
    raise exception 'Choose the branch that received the goods' using errcode = '22023';
  end if;
  if not exists (select 1 from public.suppliers s where s.id = v_supplier and s.tenant_id = v_tenant) then
    raise exception 'Choose the supplier' using errcode = '22023';
  end if;
  if v_at > now() then v_at := now(); end if;

  -- the same delivery sent twice is recorded once
  if v_client is not null then
    select * into v_existing from public.goods_receipts g where g.tenant_id = v_tenant and g.client_uuid = v_client;
    if v_existing.id is not null then
      return jsonb_build_object('receipt_id', v_existing.id, 'total', v_existing.total, 'paid', v_existing.amount_paid,
                                'balance_due', v_existing.total - v_existing.amount_paid, 'duplicate', true);
    end if;
  end if;

  if v_po is not null then
    select * into po from public.purchase_orders o where o.id = v_po and o.tenant_id = v_tenant for update;
    if po.id is null or po.supplier_id <> v_supplier or po.branch_id <> v_branch then
      raise exception 'That order does not match this supplier and branch' using errcode = '22023';
    end if;
    if po.status not in ('ordered','partially_received') then
      raise exception 'That order is %, so it cannot receive goods', po.status;
    end if;
  end if;

  if jsonb_typeof(p_data -> 'items') is distinct from 'array' or jsonb_array_length(p_data -> 'items') = 0 then
    raise exception 'Add at least one item received' using errcode = '22023';
  end if;

  for e in select x from jsonb_array_elements(p_data -> 'items') as j(x) loop
    v_qty := (e.x ->> 'qty')::numeric;
    v_cost := coalesce(nullif(e.x ->> 'unit_cost', '')::numeric, 0);
    if v_qty is null or v_qty <= 0 or v_cost < 0 then
      raise exception 'Every item needs a quantity above zero and a buying price' using errcode = '22023';
    end if;
    pr := null;
    select * into pr from public.products p where p.id = (e.x ->> 'product_id')::uuid and p.tenant_id = v_tenant;
    if pr.id is null then
      raise exception 'A product on the delivery was not found' using errcode = '22023';
    end if;
    v_total := v_total + round(v_qty * v_cost, 2);
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'product_id', pr.id, 'qty', v_qty, 'cost', v_cost, 'track', pr.track_stock,
      'po_item_id', nullif(e.x ->> 'po_item_id', '')));
  end loop;
  v_total := round(v_total, 2);

  -- payment made at the same time (money out: owner or manager only)
  if v_pay is not null and jsonb_typeof(v_pay) = 'object' and coalesce(nullif(v_pay ->> 'amount', '')::numeric, 0) > 0 then
    if not private.has_role(array['owner','manager']) then
      raise exception 'Only the owner or a manager can record a payment to a supplier' using errcode = '42501';
    end if;
    v_method := lower(coalesce(v_pay ->> 'method', ''));
    if v_method not in ('cash','mpesa','bank','other') then
      raise exception 'Choose how the supplier was paid' using errcode = '22023';
    end if;
    v_paid := round((v_pay ->> 'amount')::numeric, 2);
    v_pref := nullif(btrim(coalesce(v_pay ->> 'reference', '')), '');
    if v_paid > v_total + 0.001 then
      raise exception 'The payment is more than the goods total. Use "Pay supplier" for other payments.' using errcode = '22023';
    end if;
  end if;

  insert into public.goods_receipts
    (tenant_id, branch_id, supplier_id, po_id, supplier_invoice_no, received_at, received_by, total, amount_paid, notes, client_uuid)
  values
    (v_tenant, v_branch, v_supplier, v_po, v_invoice, v_at, v_user, v_total, v_paid, v_notes, v_client)
  returning id into v_receipt;

  for e in select x from jsonb_array_elements(v_items) as j(x) loop
    insert into public.goods_receipt_items (tenant_id, receipt_id, product_id, quantity, unit_cost)
    values (v_tenant, v_receipt, (e.x ->> 'product_id')::uuid, (e.x ->> 'qty')::numeric, (e.x ->> 'cost')::numeric);

    if (e.x ->> 'track')::boolean then
      insert into public.stock_movements
        (tenant_id, branch_id, product_id, movement_type, quantity, unit_cost, reference_type, reference_id, created_by)
      values
        (v_tenant, v_branch, (e.x ->> 'product_id')::uuid, 'purchase', (e.x ->> 'qty')::numeric,
         (e.x ->> 'cost')::numeric, 'goods_receipt', v_receipt, v_user);
    end if;

    -- weighted-average buying price: blend this receipt into the
    -- current stock value (stock_movements above already updated the
    -- stock cache, so back the receipt quantity out to get the pre-GRN stock)
    if (e.x ->> 'cost')::numeric > 0 then
      declare
        v_before numeric;
        v_old    numeric;
        v_new    numeric;
        v_after  numeric;
      begin
        select coalesce(sum(sl.quantity), 0) into v_after
          from public.stock_levels sl where sl.product_id = (e.x ->> 'product_id')::uuid and sl.tenant_id = v_tenant;
        v_before := greatest(coalesce(v_after, 0) - (e.x ->> 'qty')::numeric, 0);
        select pc.cost_price into v_old from public.product_costs pc where pc.product_id = (e.x ->> 'product_id')::uuid and pc.tenant_id = v_tenant;
        v_new := round((v_before * coalesce(v_old, (e.x ->> 'cost')::numeric) + (e.x ->> 'qty')::numeric * (e.x ->> 'cost')::numeric)
                       / nullif(v_before + (e.x ->> 'qty')::numeric, 0), 2);
        insert into public.product_costs (tenant_id, product_id, cost_price, updated_by)
        values (v_tenant, (e.x ->> 'product_id')::uuid, v_new, v_user)
        on conflict (product_id) do update set cost_price = excluded.cost_price, updated_by = v_user;
      end;
    end if;

    if v_po is not null then
      v_poi := coalesce(nullif(e.x ->> 'po_item_id', '')::uuid,
                        (select i.id from public.purchase_order_items i where i.po_id = v_po and i.product_id = (e.x ->> 'product_id')::uuid limit 1));
      if v_poi is not null then
        update public.purchase_order_items set qty_received = qty_received + (e.x ->> 'qty')::numeric
         where id = v_poi and po_id = v_po;
      end if;
    end if;
  end loop;

  if v_po is not null then
    select not exists (select 1 from public.purchase_order_items i where i.po_id = v_po and i.qty_received < i.qty_ordered) into v_done;
    update public.purchase_orders set status = case when v_done then 'received' else 'partially_received' end where id = v_po;
  end if;

  -- what you owe the supplier
  if v_total > 0 then
    insert into public.supplier_ledger (tenant_id, supplier_id, entry_type, amount, receipt_id, note, created_by)
    values (v_tenant, v_supplier, 'sale', v_total, v_receipt,
            'Goods received' || coalesce(' (invoice ' || v_invoice || ')', ''), v_user);
  end if;

  if v_paid > 0 then
    insert into public.supplier_payments (tenant_id, branch_id, supplier_id, method, amount, reference, paid_at, paid_by, note)
    values (v_tenant, v_branch, v_supplier, v_method::public.payment_method, v_paid, v_pref, v_at, v_user, 'Paid when the goods were received')
    returning id into v_pay_id;
    insert into public.supplier_ledger (tenant_id, supplier_id, entry_type, amount, payment_id, note, created_by)
    values (v_tenant, v_supplier, 'payment', -v_paid, v_pay_id, 'Payment when goods were received', v_user);
  end if;

  return jsonb_build_object('receipt_id', v_receipt, 'total', v_total, 'paid', v_paid, 'balance_due', v_total - v_paid);
end $$;

-- ---------------------------------------------------------------------
-- Pay a supplier (owner / manager)

revoke execute on function public.receive_goods(jsonb) from public, anon;
grant  execute on function public.receive_goods(jsonb) to authenticated;
