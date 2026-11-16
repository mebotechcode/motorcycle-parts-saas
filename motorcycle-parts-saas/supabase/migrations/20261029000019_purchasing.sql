-- =====================================================================
-- Phase 6b / 19 — Suppliers and purchasing
--   save_purchase_order() / cancel_purchase_order()
--   receive_goods()        : stock in + latest buying price + what you owe
--   pay_supplier()         : record a payment to a supplier
--   return_to_supplier()   : send goods back, get a credit
--   adjust_supplier_balance(): old debt (opening balance) or a correction
--   supplier_overview, purchase_prices views, suppliers_summary()
-- Purchases, receipts, supplier payments and ledgers are written ONLY by
-- these functions (so stock, prices and balances always agree).
-- =====================================================================

alter table public.goods_receipts   add column if not exists client_uuid uuid;
alter table public.supplier_payments add column if not exists client_uuid uuid;
create unique index if not exists goods_receipts_client_uuid on public.goods_receipts (tenant_id, client_uuid) where client_uuid is not null;
create unique index if not exists supplier_payments_client_uuid on public.supplier_payments (tenant_id, client_uuid) where client_uuid is not null;

revoke insert, update, delete on
  public.purchase_orders, public.purchase_order_items,
  public.goods_receipts, public.goods_receipt_items,
  public.supplier_payments, public.supplier_ledger
from authenticated;

-- ---------------------------------------------------------------------
-- Views (run with the caller's permissions)
-- ---------------------------------------------------------------------
create or replace view public.supplier_overview with (security_invoker = true) as
select s.id, s.tenant_id, s.name, s.contact_person, s.phone, s.email, s.address, s.kra_pin,
       s.payment_terms_days, s.notes, s.is_active, s.created_at, s.updated_at,
       coalesce(b.balance, 0) as balance,
       (select max(r.received_at) from public.goods_receipts r where r.supplier_id = s.id) as last_receipt_at,
       (select max(p.paid_at) from public.supplier_payments p where p.supplier_id = s.id) as last_payment_at
  from public.suppliers s
  left join public.supplier_balances b on b.supplier_id = s.id and b.tenant_id = s.tenant_id;

-- every purchase of every product: price history per supplier
create or replace view public.purchase_prices with (security_invoker = true) as
select i.id, i.tenant_id, i.product_id, i.quantity, i.unit_cost,
       r.received_at, r.supplier_id, s.name as supplier_name, r.branch_id, r.supplier_invoice_no
  from public.goods_receipt_items i
  join public.goods_receipts r on r.id = i.receipt_id and r.tenant_id = i.tenant_id
  join public.suppliers s on s.id = r.supplier_id and s.tenant_id = r.tenant_id;

grant select on public.supplier_overview, public.purchase_prices to authenticated;
grant all on public.supplier_overview, public.purchase_prices to service_role;

create or replace function public.suppliers_summary()
returns jsonb language sql stable set search_path = ''
as $$
  select jsonb_build_object(
    'owed_count', count(*) filter (where balance > 0),
    'total_owed', coalesce(sum(balance) filter (where balance > 0), 0))
  from public.supplier_overview where is_active
$$;

-- ---------------------------------------------------------------------
-- Purchase orders (what you ordered, before the goods arrive)
--   p_data: {supplier_id, branch_id, expected_date, notes, status: draft|ordered,
--            items: [{product_id, qty, unit_cost}]}
-- ---------------------------------------------------------------------
create or replace function public.save_purchase_order(p_id uuid, p_data jsonb)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_tenant   uuid := private.tenant_id();
  v_supplier uuid := nullif(p_data ->> 'supplier_id', '')::uuid;
  v_branch   uuid := nullif(p_data ->> 'branch_id', '')::uuid;
  v_status   public.po_status := coalesce(nullif(p_data ->> 'status', '')::public.po_status, 'draft');
  v_expected date := nullif(p_data ->> 'expected_date', '')::date;
  v_notes    text := nullif(btrim(coalesce(p_data ->> 'notes', '')), '');
  po  public.purchase_orders;
  e   record;
  v_id uuid := p_id;
  v_total numeric := 0;
  v_items jsonb := '[]'::jsonb;
  v_qty numeric; v_cost numeric;
begin
  if v_tenant is null or not private.has_role(array['owner','manager','storekeeper']) then
    raise exception 'You are not allowed to make purchase orders' using errcode = '42501';
  end if;
  if not private.tenant_writable() then
    raise exception 'Your subscription is not active' using errcode = '42501';
  end if;
  if v_status not in ('draft','ordered') then
    raise exception 'An order can only be saved as draft or ordered' using errcode = '22023';
  end if;
  if not exists (select 1 from public.suppliers s where s.id = v_supplier and s.tenant_id = v_tenant and s.is_active) then
    raise exception 'Choose a supplier' using errcode = '22023';
  end if;
  if v_branch is null or not private.can_access_branch(v_branch)
     or not exists (select 1 from public.branches b where b.id = v_branch and b.tenant_id = v_tenant) then
    raise exception 'Choose the branch the goods are for' using errcode = '22023';
  end if;
  if jsonb_typeof(p_data -> 'items') is distinct from 'array' or jsonb_array_length(p_data -> 'items') = 0 then
    raise exception 'Add at least one item' using errcode = '22023';
  end if;

  for e in select x from jsonb_array_elements(p_data -> 'items') as j(x) loop
    v_qty := (e.x ->> 'qty')::numeric;
    v_cost := coalesce(nullif(e.x ->> 'unit_cost', '')::numeric, 0);
    if v_qty is null or v_qty <= 0 or v_cost < 0 then
      raise exception 'Every item needs a quantity above zero and a price' using errcode = '22023';
    end if;
    if not exists (select 1 from public.products p where p.id = (e.x ->> 'product_id')::uuid and p.tenant_id = v_tenant) then
      raise exception 'A product on the order was not found' using errcode = '22023';
    end if;
    v_total := v_total + round(v_qty * v_cost, 2);
    v_items := v_items || jsonb_build_array(jsonb_build_object('product_id', e.x ->> 'product_id', 'qty', v_qty, 'cost', v_cost));
  end loop;

  if v_id is null then
    insert into public.purchase_orders
      (tenant_id, branch_id, supplier_id, po_number, status, expected_date, notes, total, created_by)
    values
      (v_tenant, v_branch, v_supplier, public.next_document_number('purchase_order'), v_status, v_expected, v_notes, v_total, auth.uid())
    returning id into v_id;
  else
    select * into po from public.purchase_orders where id = v_id and tenant_id = v_tenant for update;
    if po.id is null then
      raise exception 'Order not found' using errcode = 'P0002';
    end if;
    if po.status not in ('draft','ordered') then
      raise exception 'This order is already % and cannot be changed', po.status;
    end if;
    if not private.can_access_branch(po.branch_id) then
      raise exception 'You cannot change orders of that branch' using errcode = '42501';
    end if;
    update public.purchase_orders
       set supplier_id = v_supplier, branch_id = v_branch, status = v_status,
           expected_date = v_expected, notes = v_notes, total = v_total
     where id = v_id;
    delete from public.purchase_order_items where po_id = v_id;
  end if;

  insert into public.purchase_order_items (tenant_id, po_id, product_id, qty_ordered, unit_cost)
  select v_tenant, v_id, (x ->> 'product_id')::uuid, (x ->> 'qty')::numeric, (x ->> 'cost')::numeric
    from jsonb_array_elements(v_items) as j(x);

  return v_id;
end $$;

create or replace function public.cancel_purchase_order(p_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare v_tenant uuid := private.tenant_id(); po public.purchase_orders;
begin
  if v_tenant is null or not private.has_role(array['owner','manager','storekeeper']) then
    raise exception 'You are not allowed to cancel orders' using errcode = '42501';
  end if;
  select * into po from public.purchase_orders where id = p_id and tenant_id = v_tenant for update;
  if po.id is null then
    raise exception 'Order not found' using errcode = 'P0002';
  end if;
  if po.status not in ('draft','ordered') then
    raise exception 'Only an order that has not arrived yet can be cancelled (this one is %)', po.status;
  end if;
  update public.purchase_orders set status = 'cancelled' where id = po.id;
end $$;

-- ---------------------------------------------------------------------
-- Goods received
--   p_data: {supplier_id, branch_id, po_id?, supplier_invoice_no, notes, received_at?, client_uuid,
--            items: [{product_id, qty, unit_cost, po_item_id?}],
--            payment?: {method, amount, reference}}      (payment: owner/manager only)
-- Adds stock, saves the latest buying price, and adds the amount to what you owe.
-- ---------------------------------------------------------------------
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

    -- latest buying price
    if (e.x ->> 'cost')::numeric > 0 then
      insert into public.product_costs (tenant_id, product_id, cost_price, updated_by)
      values (v_tenant, (e.x ->> 'product_id')::uuid, (e.x ->> 'cost')::numeric, v_user)
      on conflict (product_id) do update set cost_price = excluded.cost_price, updated_by = v_user;
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
-- ---------------------------------------------------------------------
create or replace function public.pay_supplier(p_data jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_tenant   uuid := private.tenant_id();
  v_supplier uuid := nullif(p_data ->> 'supplier_id', '')::uuid;
  v_branch   uuid := nullif(p_data ->> 'branch_id', '')::uuid;
  v_client   uuid := nullif(p_data ->> 'client_uuid', '')::uuid;
  v_amount   numeric := round(coalesce(nullif(p_data ->> 'amount', '')::numeric, 0), 2);
  v_method   text := lower(coalesce(p_data ->> 'method', ''));
  v_ref      text := nullif(btrim(coalesce(p_data ->> 'reference', '')), '');
  v_note     text := nullif(btrim(coalesce(p_data ->> 'note', '')), '');
  v_name text; v_pay uuid; v_balance numeric;
begin
  if v_tenant is null or not private.has_role(array['owner','manager']) then
    raise exception 'Only the owner or a manager can pay suppliers' using errcode = '42501';
  end if;
  if not private.tenant_writable() then
    raise exception 'Your subscription is not active' using errcode = '42501';
  end if;
  if v_method not in ('cash','mpesa','bank','other') then
    raise exception 'Choose how you paid' using errcode = '22023';
  end if;
  if v_amount <= 0 then
    raise exception 'Enter an amount more than zero' using errcode = '22023';
  end if;
  if v_branch is not null and not private.can_access_branch(v_branch) then
    raise exception 'You cannot record payments for that branch' using errcode = '42501';
  end if;
  select s.name into v_name from public.suppliers s where s.id = v_supplier and s.tenant_id = v_tenant;
  if v_name is null then
    raise exception 'Supplier not found' using errcode = '22023';
  end if;

  if v_client is not null and exists (select 1 from public.supplier_payments p where p.tenant_id = v_tenant and p.client_uuid = v_client) then
    select coalesce(sum(l.amount), 0) into v_balance from public.supplier_ledger l where l.tenant_id = v_tenant and l.supplier_id = v_supplier;
    return jsonb_build_object('supplier', v_name, 'amount', v_amount, 'balance_after', v_balance, 'duplicate', true);
  end if;

  insert into public.supplier_payments (tenant_id, branch_id, supplier_id, method, amount, reference, paid_by, note, client_uuid)
  values (v_tenant, v_branch, v_supplier, v_method::public.payment_method, v_amount, v_ref, auth.uid(), v_note, v_client)
  returning id into v_pay;

  insert into public.supplier_ledger (tenant_id, supplier_id, entry_type, amount, payment_id, note, created_by)
  values (v_tenant, v_supplier, 'payment', -v_amount, v_pay,
          'Payment (' || v_method || ')' || coalesce(' ' || v_ref, '') || coalesce(' - ' || v_note, ''), auth.uid());

  select coalesce(sum(l.amount), 0) into v_balance from public.supplier_ledger l where l.tenant_id = v_tenant and l.supplier_id = v_supplier;
  return jsonb_build_object('supplier', v_name, 'amount', v_amount, 'balance_after', v_balance);
end $$;

-- ---------------------------------------------------------------------
-- Send goods back to the supplier: stock goes down, you owe less
--   p_data: {supplier_id, branch_id, reason, items: [{product_id, qty, unit_cost}]}
-- ---------------------------------------------------------------------
create or replace function public.return_to_supplier(p_data jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_tenant   uuid := private.tenant_id();
  v_supplier uuid := nullif(p_data ->> 'supplier_id', '')::uuid;
  v_branch   uuid := nullif(p_data ->> 'branch_id', '')::uuid;
  v_reason   text := btrim(coalesce(p_data ->> 'reason', ''));
  e record; pr public.products;
  v_qty numeric; v_cost numeric; v_credit numeric := 0; v_balance numeric;
begin
  if v_tenant is null or not private.has_role(array['owner','manager','storekeeper']) then
    raise exception 'You are not allowed to return goods to a supplier' using errcode = '42501';
  end if;
  if not private.tenant_writable() then
    raise exception 'Your subscription is not active' using errcode = '42501';
  end if;
  if length(v_reason) < 3 then
    raise exception 'Please give a reason' using errcode = '22023';
  end if;
  if v_branch is null or not private.can_access_branch(v_branch)
     or not exists (select 1 from public.branches b where b.id = v_branch and b.tenant_id = v_tenant) then
    raise exception 'Choose the branch' using errcode = '22023';
  end if;
  if not exists (select 1 from public.suppliers s where s.id = v_supplier and s.tenant_id = v_tenant) then
    raise exception 'Choose the supplier' using errcode = '22023';
  end if;
  if jsonb_typeof(p_data -> 'items') is distinct from 'array' or jsonb_array_length(p_data -> 'items') = 0 then
    raise exception 'Add at least one item' using errcode = '22023';
  end if;

  for e in select x from jsonb_array_elements(p_data -> 'items') as j(x) loop
    v_qty := (e.x ->> 'qty')::numeric;
    v_cost := coalesce(nullif(e.x ->> 'unit_cost', '')::numeric, 0);
    pr := null;
    select * into pr from public.products p where p.id = (e.x ->> 'product_id')::uuid and p.tenant_id = v_tenant;
    if pr.id is null or v_qty is null or v_qty <= 0 or v_cost < 0 then
      raise exception 'Check the items being returned' using errcode = '22023';
    end if;
    if pr.track_stock then
      insert into public.stock_movements
        (tenant_id, branch_id, product_id, movement_type, quantity, unit_cost, reference_type, reason, created_by)
      values (v_tenant, v_branch, pr.id, 'supplier_return', -v_qty, v_cost, 'supplier_return', v_reason, auth.uid());
    end if;
    v_credit := v_credit + round(v_qty * v_cost, 2);
  end loop;

  if v_credit > 0 then
    insert into public.supplier_ledger (tenant_id, supplier_id, entry_type, amount, note, created_by)
    values (v_tenant, v_supplier, 'return', -v_credit, 'Goods returned: ' || v_reason, auth.uid());
  end if;

  select coalesce(sum(l.amount), 0) into v_balance from public.supplier_ledger l where l.tenant_id = v_tenant and l.supplier_id = v_supplier;
  return jsonb_build_object('credit', v_credit, 'balance_after', v_balance);
end $$;

-- ---------------------------------------------------------------------
-- Old debt to a supplier, or a correction (owner / manager)
-- ---------------------------------------------------------------------
create or replace function public.adjust_supplier_balance(
  p_supplier_id uuid, p_amount numeric, p_reason text, p_opening boolean default false
) returns numeric
language plpgsql security definer set search_path = ''
as $$
declare v_tenant uuid := private.tenant_id(); v_name text; v_balance numeric;
begin
  if v_tenant is null or not private.has_role(array['owner','manager']) then
    raise exception 'Only the owner or a manager can change a supplier balance' using errcode = '42501';
  end if;
  if not private.tenant_writable() then
    raise exception 'Your subscription is not active' using errcode = '42501';
  end if;
  if p_amount is null or p_amount = 0 then
    raise exception 'Enter the amount' using errcode = '22023';
  end if;
  if p_opening and p_amount < 0 then
    raise exception 'An opening balance must be more than zero' using errcode = '22023';
  end if;
  if not p_opening and length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Please give a reason' using errcode = '22023';
  end if;
  select s.name into v_name from public.suppliers s where s.id = p_supplier_id and s.tenant_id = v_tenant;
  if v_name is null then
    raise exception 'Supplier not found' using errcode = '22023';
  end if;

  insert into public.supplier_ledger (tenant_id, supplier_id, entry_type, amount, note, created_by)
  values (v_tenant, p_supplier_id, case when p_opening then 'opening_balance' else 'adjustment' end::public.ledger_entry_type,
          round(p_amount, 2),
          case when p_opening then coalesce(nullif(btrim(coalesce(p_reason, '')), ''), 'Opening balance (owed before the system)')
               else 'Adjustment: ' || btrim(p_reason) end,
          auth.uid());

  insert into public.audit_logs (tenant_id, user_id, action, table_name, record_id, new_data)
  values (v_tenant, auth.uid(), case when p_opening then 'supplier_opening_balance' else 'supplier_adjustment' end,
          'supplier_ledger', p_supplier_id::text,
          jsonb_build_object('supplier', v_name, 'amount', round(p_amount, 2), 'reason', p_reason));

  select coalesce(sum(l.amount), 0) into v_balance from public.supplier_ledger l where l.tenant_id = v_tenant and l.supplier_id = p_supplier_id;
  return v_balance;
end $$;

-- ---------------------------------------------------------------------
revoke execute on function public.suppliers_summary() from public, anon;
revoke execute on function public.save_purchase_order(uuid, jsonb) from public, anon;
revoke execute on function public.cancel_purchase_order(uuid) from public, anon;
revoke execute on function public.receive_goods(jsonb) from public, anon;
revoke execute on function public.pay_supplier(jsonb) from public, anon;
revoke execute on function public.return_to_supplier(jsonb) from public, anon;
revoke execute on function public.adjust_supplier_balance(uuid, numeric, text, boolean) from public, anon;
grant execute on function public.suppliers_summary() to authenticated;
grant execute on function public.save_purchase_order(uuid, jsonb) to authenticated;
grant execute on function public.cancel_purchase_order(uuid) to authenticated;
grant execute on function public.receive_goods(jsonb) to authenticated;
grant execute on function public.pay_supplier(jsonb) to authenticated;
grant execute on function public.return_to_supplier(jsonb) to authenticated;
grant execute on function public.adjust_supplier_balance(uuid, numeric, text, boolean) to authenticated;
