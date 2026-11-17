-- =====================================================================
-- Phase 8 / 24 — return_items extended with Kenyan return types
--   wrong_part (default) | defective | warranty | exchange | customer_change
-- The old 4-argument function is dropped and recreated with defaults
-- (create-or-replace cannot change an argument list, and keeping two
-- overloads would make PostgREST named-argument calls ambiguous).
-- =====================================================================

drop function if exists public.return_items(uuid, jsonb, public.refund_method, text);

create or replace function public.return_items(
  p_sale_id       uuid,
  p_items         jsonb,
  p_refund_method public.refund_method,
  p_reason        text,
  p_return_type   text default 'wrong_part',
  p_exchange_sale_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_tenant uuid := private.tenant_id();
  s   public.sales;
  si  public.sale_items;
  e   record;
  v_factor numeric;
  v_q numeric; v_refund numeric; v_total numeric := 0;
  v_prep jsonb := '[]'::jsonb;
  v_ret uuid; v_no text; v_all boolean; v_track boolean;
begin
  if v_tenant is null or not private.has_role(array['owner','manager']) then
    raise exception 'Only the owner or a manager can take items back' using errcode = '42501';
  end if;
  if not private.tenant_writable() then
    raise exception 'Your subscription is not active' using errcode = '42501';
  end if;
  if p_return_type not in ('wrong_part','defective','warranty','exchange','customer_change') then
    raise exception 'Unknown return type' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Please give a reason for the return' using errcode = '22023';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Choose the items being returned' using errcode = '22023';
  end if;

  select * into s from public.sales where id = p_sale_id and tenant_id = v_tenant for update;
  if s.id is null then
    raise exception 'Sale not found' using errcode = 'P0002';
  end if;
  if not private.can_access_branch(s.branch_id) then
    raise exception 'You cannot change sales of that branch' using errcode = '42501';
  end if;
  if s.status not in ('completed','partially_returned') then
    raise exception 'This sale cannot be returned (it is %)', s.status;
  end if;
  if p_refund_method = 'debt_credit' and s.customer_id is null then
    raise exception 'This sale has no customer, so choose cash, M-Pesa or bank for the refund' using errcode = '22023';
  end if;

  v_factor := case when s.subtotal > 0 then s.total / s.subtotal else 1 end;

  -- check everything first
  for e in select x from jsonb_array_elements(p_items) as j(x) loop
    select * into si from public.sale_items
     where id = (e.x ->> 'sale_item_id')::uuid and sale_id = s.id and tenant_id = v_tenant for update;
    if si.id is null then
      raise exception 'An item was not found on this sale' using errcode = '22023';
    end if;
    v_q := (e.x ->> 'qty')::numeric;
    if v_q is null or v_q <= 0 or v_q > si.quantity - si.returned_qty then
      raise exception 'You can return at most % of "%"', si.quantity - si.returned_qty, si.product_name using errcode = '22023';
    end if;
    v_refund := round(v_q * (si.line_total / si.quantity) * v_factor, 2);
    v_total := v_total + v_refund;
    v_prep := v_prep || jsonb_build_array(jsonb_build_object(
      'item_id', si.id, 'product_id', si.product_id, 'qty', v_q, 'refund', v_refund,
      'unit', round(si.line_total / si.quantity * v_factor, 2), 'cost', si.unit_cost,
      'restock', coalesce((e.x ->> 'restock')::boolean, true)));
  end loop;

  v_no := public.next_document_number('return', s.branch_id);
  insert into public.sale_returns (tenant_id, branch_id, sale_id, return_no, reason, refund_method, total_refund, processed_by, return_type, exchange_sale_id)
  values (v_tenant, s.branch_id, s.id, v_no, btrim(p_reason), p_refund_method, v_total, auth.uid(), p_return_type, p_exchange_sale_id)
  returning id into v_ret;

  for e in select x from jsonb_array_elements(v_prep) as j(x) loop
    insert into public.sale_return_items (tenant_id, return_id, sale_item_id, product_id, quantity, unit_price, line_total, restock)
    values (v_tenant, v_ret, (e.x ->> 'item_id')::uuid, (e.x ->> 'product_id')::uuid, (e.x ->> 'qty')::numeric,
            (e.x ->> 'unit')::numeric, (e.x ->> 'refund')::numeric, (e.x ->> 'restock')::boolean);

    update public.sale_items set returned_qty = returned_qty + (e.x ->> 'qty')::numeric
     where id = (e.x ->> 'item_id')::uuid;

    select p.track_stock into v_track from public.products p where p.id = (e.x ->> 'product_id')::uuid;
    if (e.x ->> 'restock')::boolean and v_track then
      insert into public.stock_movements
        (tenant_id, branch_id, product_id, movement_type, quantity, unit_cost, reference_type, reference_id, reason, created_by)
      values
        (v_tenant, s.branch_id, (e.x ->> 'product_id')::uuid, 'sale_return', (e.x ->> 'qty')::numeric,
         (e.x ->> 'cost')::numeric, 'sale_return', v_ret, 'Return ' || v_no, auth.uid());
    end if;
  end loop;

  select not exists (select 1 from public.sale_items i where i.sale_id = s.id and i.returned_qty < i.quantity) into v_all;
  update public.sales set status = case when v_all then 'returned' else 'partially_returned' end where id = s.id;

  -- customer account: the returned value reduces what they owe; money paid out is added back
  if s.customer_id is not null and v_total > 0 then
    insert into public.customer_ledger (tenant_id, customer_id, branch_id, entry_type, amount, sale_id, note, created_by)
    values (v_tenant, s.customer_id, s.branch_id, 'return', -v_total, s.id, 'Return ' || v_no, auth.uid());
    if p_refund_method in ('cash','mpesa','bank') then
      insert into public.customer_ledger (tenant_id, customer_id, branch_id, entry_type, amount, sale_id, note, created_by)
      values (v_tenant, s.customer_id, s.branch_id, 'adjustment', v_total, s.id, 'Refund paid out for ' || v_no, auth.uid());
    end if;
  end if;

  return jsonb_build_object('return_id', v_ret, 'return_no', v_no, 'refund', v_total);
end $$;


revoke execute on function public.return_items(uuid, jsonb, public.refund_method, text, text, uuid) from public, anon;
grant  execute on function public.return_items(uuid, jsonb, public.refund_method, text, text, uuid) to authenticated;
