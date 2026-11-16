-- =====================================================================
-- Phase 2 / 10 — Row Level Security policies for every table
--
-- Rule of thumb for every tenant table:
--   1. row.tenant_id must equal the tenant_id in the user's token
--   2. the user's role must be allowed to do that action
--   3. writes also require the business to be in good standing
--      (private.tenant_writable())
--   4. branch-limited staff only touch their own branches
--
-- Roles: owner > manager > (cashier | storekeeper)
-- =====================================================================

-- Helper that builds the 4 policies (select/insert/update/delete) for a table.
--   p_sel/p_ins/p_upd/p_del : allowed roles, or NULL = no policy (action denied)
--   p_extra                 : extra SQL condition (e.g. branch access)
--   p_tag                   : suffix so one table can have several policy sets
create or replace function private.set_policies(
  p_table text,
  p_sel text[] default null,
  p_ins text[] default null,
  p_upd text[] default null,
  p_del text[] default null,
  p_extra text default 'true',
  p_tag text default ''
) returns void language plpgsql as $$
declare
  scope text := format('tenant_id = (select private.tenant_id()) and (%s)', p_extra);
  wr    text := '(select private.tenant_writable())';
begin
  if p_sel is not null then
    execute format(
      'create policy %I on public.%I for select to authenticated
         using (%s and (select private.has_role(%L::text[])))',
      p_table || '_select' || p_tag, p_table, scope, p_sel);
  end if;
  if p_ins is not null then
    execute format(
      'create policy %I on public.%I for insert to authenticated
         with check (%s and %s and (select private.has_role(%L::text[])))',
      p_table || '_insert' || p_tag, p_table, scope, wr, p_ins);
  end if;
  if p_upd is not null then
    execute format(
      'create policy %I on public.%I for update to authenticated
         using      (%s and %s and (select private.has_role(%L::text[])))
         with check (%s and %s and (select private.has_role(%L::text[])))',
      p_table || '_update' || p_tag, p_table, scope, wr, p_upd, scope, wr, p_upd);
  end if;
  if p_del is not null then
    execute format(
      'create policy %I on public.%I for delete to authenticated
         using (%s and %s and (select private.has_role(%L::text[])))',
      p_table || '_delete' || p_tag, p_table, scope, wr, p_del);
  end if;
end $$;

revoke all on function private.set_policies(text, text[], text[], text[], text[], text, text) from public;

-- Shortcuts for readability
do $$
declare
  ALL_ROLES  text[] := array['owner','manager','cashier','storekeeper'];
  OM         text[] := array['owner','manager'];
  OMS        text[] := array['owner','manager','storekeeper'];
  OMC        text[] := array['owner','manager','cashier'];
  O          text[] := array['owner'];
  BR         text := 'private.can_access_branch(branch_id)';
  BR_OR_NULL text := 'branch_id is null or private.can_access_branch(branch_id)';
begin
  -------------------------------------------------------------------
  -- SaaS / tenancy tables
  -------------------------------------------------------------------
  perform private.set_policies('branches',            ALL_ROLES, O, O, O);
  perform private.set_policies('tenant_members',      OM, O, O, O);
  perform private.set_policies('member_branches',     OM, O, O, O);
  perform private.set_policies('tenant_invites',      OM, O, O, O);
  perform private.set_policies('subscriptions',       OM);                  -- writes: service role only
  perform private.set_policies('subscription_invoices',  O);
  perform private.set_policies('subscription_payments',  O);
  perform private.set_policies('tenant_integrations', OM, O, O, O);
  perform private.set_policies('tenant_mpesa_accounts', OM, O, O, O);
  -- document_sequences: no policies on purpose (only next_document_number() touches it)

  -------------------------------------------------------------------
  -- Catalog: everyone reads; owner/manager/storekeeper edit; owner/manager delete
  -------------------------------------------------------------------
  perform private.set_policies('product_categories',   ALL_ROLES, OMS, OMS, OM);
  perform private.set_policies('brands',               ALL_ROLES, OMS, OMS, OM);
  perform private.set_policies('products',             ALL_ROLES, OMS, OMS, OM);
  perform private.set_policies('product_barcodes',     ALL_ROLES, OMS, OMS, OM);
  perform private.set_policies('product_compatibility',ALL_ROLES, OMS, OMS, OM);

  -------------------------------------------------------------------
  -- Inventory
  -------------------------------------------------------------------
  -- stock_levels is maintained by a trigger: read-only for users
  perform private.set_policies('stock_levels',    ALL_ROLES, null, null, null, BR);
  -- movements are append-only: no update/delete policy
  perform private.set_policies('stock_movements', OMS, OMS, null, null, BR);
  perform private.set_policies('stock_transfers', OMS, OMS, OMS, OM,
          '(private.can_access_branch(from_branch_id) or private.can_access_branch(to_branch_id))');
  perform private.set_policies('stock_transfer_items', OMS, OMS, OMS, OM,
          'exists (select 1 from public.stock_transfers p
                    where p.tenant_id = stock_transfer_items.tenant_id
                      and p.id = stock_transfer_items.transfer_id)');

  -------------------------------------------------------------------
  -- Customers & suppliers
  -------------------------------------------------------------------
  perform private.set_policies('customers', OMC, OMC, OMC, OM);
  perform private.set_policies('suppliers', OMS, OM,  OM,  O);

  -------------------------------------------------------------------
  -- Sales (owner/manager see everything in their branches; cashiers see
  -- only what THEY created — extra policies for cashiers are below)
  -------------------------------------------------------------------
  perform private.set_policies('sales',         OM, OM, OM, null, BR);
  perform private.set_policies('sale_items',    OMC, OMC, OM, OM,
          'exists (select 1 from public.sales p
                    where p.tenant_id = sale_items.tenant_id
                      and p.id = sale_items.sale_id)');
  perform private.set_policies('payments',      OM, OM, null, null, BR);     -- immutable once recorded
  perform private.set_policies('mpesa_transactions', OMC, null, null, null, BR_OR_NULL);  -- written by Edge Functions
  perform private.set_policies('cash_sessions', OM, OM, OM, null, BR);
  -- returns need a manager/owner (anti-fraud)
  perform private.set_policies('sale_returns',  OM, OM, null, null, BR);
  perform private.set_policies('sale_return_items', OM, OM, null, null,
          'exists (select 1 from public.sale_returns p
                    where p.tenant_id = sale_return_items.tenant_id
                      and p.id = sale_return_items.return_id)');
  -- ledgers are business-wide (a customer's debt is the same in every branch)
  perform private.set_policies('customer_ledger', OMC, OM, null, null);

  -------------------------------------------------------------------
  -- Purchasing
  -------------------------------------------------------------------
  perform private.set_policies('purchase_orders', OMS, OMS, OMS, OM, BR);
  perform private.set_policies('purchase_order_items', OMS, OMS, OMS, OM,
          'exists (select 1 from public.purchase_orders p
                    where p.tenant_id = purchase_order_items.tenant_id
                      and p.id = purchase_order_items.po_id)');
  perform private.set_policies('goods_receipts', OMS, OMS, OMS, OM, BR);
  perform private.set_policies('goods_receipt_items', OMS, OMS, OMS, OM,
          'exists (select 1 from public.goods_receipts p
                    where p.tenant_id = goods_receipt_items.tenant_id
                      and p.id = goods_receipt_items.receipt_id)');
  perform private.set_policies('supplier_payments', OM, OM, null, null, BR_OR_NULL);
  perform private.set_policies('supplier_ledger',   OM, OM, null, null);

  -------------------------------------------------------------------
  -- Expenses, SMS, audit
  -------------------------------------------------------------------
  perform private.set_policies('expense_categories', ALL_ROLES, OM, OM, OM);
  perform private.set_policies('expenses',    OM, OMC, OM, OM, BR);
  perform private.set_policies('sms_messages', OM, OM);
  perform private.set_policies('audit_logs',   OM);           -- written only by triggers
end $$;

-- ---------------------------------------------------------------------
-- Cashier-specific policies (own records only)
-- ---------------------------------------------------------------------
create policy sales_select_cashier on public.sales for select to authenticated
  using (tenant_id = (select private.tenant_id())
         and (select private.has_role(array['cashier']))
         and cashier_id = (select auth.uid())
         and private.can_access_branch(branch_id));

create policy sales_insert_cashier on public.sales for insert to authenticated
  with check (tenant_id = (select private.tenant_id())
         and (select private.has_role(array['cashier']))
         and (select private.tenant_writable())
         and cashier_id = (select auth.uid())
         and private.can_access_branch(branch_id));

-- a cashier may only finish their own HELD sale; completed sales are locked
create policy sales_update_cashier on public.sales for update to authenticated
  using (tenant_id = (select private.tenant_id())
         and (select private.has_role(array['cashier']))
         and (select private.tenant_writable())
         and cashier_id = (select auth.uid())
         and status = 'held'
         and private.can_access_branch(branch_id))
  with check (tenant_id = (select private.tenant_id())
         and cashier_id = (select auth.uid())
         and private.can_access_branch(branch_id));

create policy payments_select_cashier on public.payments for select to authenticated
  using (tenant_id = (select private.tenant_id())
         and (select private.has_role(array['cashier']))
         and received_by = (select auth.uid())
         and private.can_access_branch(branch_id));

create policy payments_insert_cashier on public.payments for insert to authenticated
  with check (tenant_id = (select private.tenant_id())
         and (select private.has_role(array['cashier']))
         and (select private.tenant_writable())
         and received_by = (select auth.uid())
         and private.can_access_branch(branch_id));

create policy cash_sessions_select_cashier on public.cash_sessions for select to authenticated
  using (tenant_id = (select private.tenant_id())
         and (select private.has_role(array['cashier']))
         and opened_by = (select auth.uid()));

create policy cash_sessions_insert_cashier on public.cash_sessions for insert to authenticated
  with check (tenant_id = (select private.tenant_id())
         and (select private.has_role(array['cashier']))
         and (select private.tenant_writable())
         and opened_by = (select auth.uid())
         and private.can_access_branch(branch_id));

create policy cash_sessions_update_cashier on public.cash_sessions for update to authenticated
  using (tenant_id = (select private.tenant_id())
         and (select private.has_role(array['cashier']))
         and (select private.tenant_writable())
         and opened_by = (select auth.uid()))
  with check (tenant_id = (select private.tenant_id())
         and opened_by = (select auth.uid()));

create policy expenses_select_cashier on public.expenses for select to authenticated
  using (tenant_id = (select private.tenant_id())
         and (select private.has_role(array['cashier']))
         and created_by = (select auth.uid()));

-- every member can see their own membership row (so the app can show "your role")
create policy tenant_members_select_self on public.tenant_members for select to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------
-- Tables without a plain tenant_id rule
-- ---------------------------------------------------------------------
-- tenants: you see your own business; only the owner edits it. New tenants
-- are created by a Phase 3 function (no direct insert).
create policy tenants_select on public.tenants for select to authenticated
  using (id = (select private.tenant_id()));
create policy tenants_update on public.tenants for update to authenticated
  using (id = (select private.tenant_id())
         and (select private.has_role(array['owner'])) and (select private.tenant_writable()))
  with check (id = (select private.tenant_id()));

-- plans: everyone signed in can see active plans
create policy plans_select on public.plans for select to authenticated using (is_active);

-- profiles: your own, plus colleagues in your business
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid())
         or exists (select 1 from public.tenant_members m
                     where m.user_id = profiles.id
                       and m.tenant_id = (select private.tenant_id())));
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- bike makes/models: platform rows (tenant_id null) readable by all;
-- each shop manages only its own custom rows
create policy bike_makes_select on public.bike_makes for select to authenticated
  using (tenant_id is null or tenant_id = (select private.tenant_id()));
create policy bike_makes_write on public.bike_makes for all to authenticated
  using (tenant_id = (select private.tenant_id())
         and (select private.has_role(array['owner','manager','storekeeper']))
         and (select private.tenant_writable()))
  with check (tenant_id = (select private.tenant_id())
         and (select private.has_role(array['owner','manager','storekeeper']))
         and (select private.tenant_writable()));
create policy bike_models_select on public.bike_models for select to authenticated
  using (tenant_id is null or tenant_id = (select private.tenant_id()));
create policy bike_models_write on public.bike_models for all to authenticated
  using (tenant_id = (select private.tenant_id())
         and (select private.has_role(array['owner','manager','storekeeper']))
         and (select private.tenant_writable()))
  with check (tenant_id = (select private.tenant_id())
         and (select private.has_role(array['owner','manager','storekeeper']))
         and (select private.tenant_writable()));

-- ---------------------------------------------------------------------
-- Platform admin (you, the SaaS owner)
--   * can READ every table (support, monitoring)
--   * can WRITE only the SaaS-management tables, never shop sales/stock data
-- ---------------------------------------------------------------------
do $$
declare r record;
begin
  for r in select tablename from pg_tables
            where schemaname = 'public' and tablename <> 'platform_admins'
  loop
    execute format(
      'create policy %I on public.%I for select to authenticated using ((select private.is_platform_admin()))',
      r.tablename || '_platform_read', r.tablename);
  end loop;

  for r in select unnest(array['plans','tenants','subscriptions','subscription_invoices',
                               'subscription_payments','bike_makes','bike_models']) as t
  loop
    execute format(
      'create policy %I on public.%I for all to authenticated
         using ((select private.is_platform_admin()))
         with check ((select private.is_platform_admin()))',
      r.t || '_platform_write', r.t);
  end loop;
end $$;
