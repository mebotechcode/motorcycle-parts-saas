-- =====================================================================
-- Phase 8 / 25 — receive_transfer logs WHY stock went missing
-- p_received: [{item_id, qty, note?}]. A note is required for any line
-- where fewer units arrived than were dispatched. Stored on
-- stock_transfer_items.discrepancy_note and included in the stock
-- movement reason, so owners can audit in-transit losses.
-- =====================================================================

create or replace function public.receive_transfer(p_transfer_id uuid, p_received jsonb default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_tenant uuid := private.tenant_id();
  t        public.stock_transfers;
  it       record;
  v_recv   numeric;
  v_note   text;
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
    v_note := null;
    if p_received is not null then
      select (x ->> 'qty')::numeric, nullif(btrim(x ->> 'note'), '')
        into v_recv, v_note
        from jsonb_array_elements(p_received) as x
       where (x ->> 'item_id')::uuid = it.id
       limit 1;
      v_recv := coalesce(v_recv, it.qty_sent);
    end if;
    -- fewer arrived than sent: insist on a note so the discrepancy is explainable
    if v_recv < it.qty_sent and v_note is null then
      raise exception 'Please say what happened to the missing % of "%"', it.qty_sent - v_recv, (select name from public.products p where p.id = it.product_id);
    end if;
    if v_recv < 0 or v_recv > it.qty_sent then
      raise exception 'Received quantity must be between 0 and the quantity sent' using errcode = '22023';
    end if;

    update public.stock_transfer_items set qty_received = v_recv, discrepancy_note = case when v_recv < it.qty_sent then v_note else null end where id = it.id;

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
         'Short delivery on ' || t.transfer_no || ': sent ' || it.qty_sent || ', received ' || v_recv || coalesce(' — ' || v_note, ''), auth.uid());
    end if;
  end loop;

  update public.stock_transfers
     set status = 'received', received_by = auth.uid(), received_at = now()
   where id = t.id;
end $$;


revoke execute on function public.receive_transfer(uuid, jsonb) from public, anon;
grant  execute on function public.receive_transfer(uuid, jsonb) to authenticated;
