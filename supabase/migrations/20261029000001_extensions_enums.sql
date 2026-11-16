-- =====================================================================
-- Phase 1 / 01 — Extensions, enums, helpers
-- =====================================================================
create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;  -- fuzzy part search

-- Tenancy & SaaS
create type public.app_role            as enum ('owner','manager','cashier','storekeeper');
create type public.member_status       as enum ('active','disabled');
create type public.tenant_status       as enum ('active','suspended','closed');
create type public.subscription_status as enum ('trialing','active','past_due','suspended','cancelled');
create type public.invoice_status      as enum ('open','paid','void');
create type public.integration_provider as enum ('mpesa','etims','sms');

-- Catalog
create type public.quality_grade as enum ('genuine','oem','aftermarket','refurbished');
create type public.tax_category  as enum ('standard','zero_rated','exempt');
create type public.price_tier    as enum ('retail','wholesale');
create type public.customer_type as enum ('retail','rider','mechanic','wholesale');

-- Inventory
create type public.stock_movement_type as enum
  ('opening','purchase','sale','sale_return','transfer_out','transfer_in',
   'adjustment','damage','supplier_return');
create type public.transfer_status as enum ('draft','in_transit','received','cancelled');

-- Sales & payments
create type public.sale_status         as enum ('held','completed','voided','partially_returned','returned');
create type public.payment_method      as enum ('cash','mpesa','bank','other');
create type public.payment_kind        as enum ('sale_payment','debt_repayment');
create type public.ledger_entry_type   as enum ('opening_balance','sale','payment','return','adjustment');
create type public.refund_method       as enum ('cash','mpesa','bank','debt_credit','exchange');
create type public.cash_session_status as enum ('open','closed');
create type public.mpesa_kind          as enum ('stk_push','c2b');
create type public.mpesa_status        as enum ('pending','success','failed','cancelled','timeout');
create type public.etims_status        as enum ('not_required','pending','submitted','failed');

-- Purchasing & comms
create type public.po_status  as enum ('draft','ordered','partially_received','received','cancelled');
create type public.sms_status as enum ('queued','sent','delivered','failed');

-- Generic updated_at trigger function (attached to every table in migration 08)
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;
