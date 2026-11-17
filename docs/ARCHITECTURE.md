# Motorcycle Spare Parts SaaS — Architecture (Phase 1)

## 1. Overview
Multi-tenant SaaS for motorcycle spare parts shops in Kenya. One tenant = one business with 1–10 branches.

```
 Android / PC browser (PWA, offline-first)
   Next.js + TS + Tailwind + shadcn/ui
   IndexedDB (cache + outbox queue)
              │  supabase-js (JWT)
              ▼
 ┌─────────────────────── Supabase ───────────────────────┐
 │ Auth (JWT + custom claims: tenant_id, role, branch_ids)│
 │ Postgres (RLS on every table, triggers, RPC functions) │
 │ Edge Functions: STK Push, M-Pesa callbacks, billing,   │
 │                 eTIMS submit, SMS, scheduled jobs      │
 │ Storage (logos, product images) · Vault (API secrets)  │
 └─────────────────────────────────────────────────────────┘
        ▲                         ▲
   Safaricom Daraja          KRA eTIMS / SMS provider
```

## 2. Multi-tenancy model
- Shared database, shared schema. Every tenant-owned table has `tenant_id`.
- Isolation layer 1 (Phase 2): RLS policies keyed on `tenant_id` from the JWT.
- Isolation layer 2 (Phase 1, already in the schema): composite foreign keys
  `(tenant_id, parent_id) -> parent (tenant_id, id)` so a row can never reference another tenant's data.
- RLS is enabled on all tables now with no policies (default deny) until Phase 2.
- Users can belong to several tenants (`tenant_members`); the active tenant is chosen at login and written into the JWT.
- Global reference data (bike makes/models, plans) is readable by all; `bike_*` rows with `tenant_id` null are platform-owned.

## 3. Key design decisions
| Decision | Why |
|---|---|
| `stock_movements` append-only + `stock_levels` cache | Full audit trail, easy recount, fast reads |
| Ledgers (`customer_ledger`, `supplier_ledger`) + balance views | Debt is always derivable and auditable |
| `client_uuid` on sales, payments, stock movements | Idempotent offline sync: a retried upload cannot duplicate |
| Soft delete (`deleted_at`) + `updated_at` index | Offline delta sync ("give me everything changed since X") |
| Unique `(tenant_id, mpesa_receipt)` | Safaricom retries callbacks; processing stays idempotent |
| Snapshot fields on `sale_items` (name, sku, cost) | Reports stay correct when products change later |
| Secrets in Vault, only ids in `tenant_integrations` | No API keys in normal tables |
| Prices VAT-inclusive; `tax_total` = VAT portion | Matches Kenyan retail practice and eTIMS needs |

## 4. Table map
- **Platform/SaaS:** plans, tenants, profiles, platform_admins, subscriptions, subscription_invoices, subscription_payments, tenant_integrations, tenant_mpesa_accounts, document_sequences
- **Staff:** tenant_members, member_branches, tenant_invites, branches
- **Catalog:** product_categories, brands, bike_makes, bike_models, products, product_barcodes, product_compatibility
- **Inventory:** stock_levels, stock_movements, stock_transfers, stock_transfer_items
- **Parties:** customers, suppliers
- **Sales:** cash_sessions, sales, sale_items, payments, mpesa_transactions, sale_returns, sale_return_items, customer_ledger (+ view customer_balances)
- **Purchasing:** purchase_orders, purchase_order_items, goods_receipts, goods_receipt_items, supplier_payments, supplier_ledger (+ view supplier_balances)
- **Ops:** expense_categories, expenses, sms_messages, audit_logs

## 5. Folder structure
```
motorcycle-parts-saas/
├── supabase/
│   ├── config.toml
│   ├── migrations/            ← Phase 1 SQL (this delivery)
│   ├── seed.sql
│   ├── functions/             ← Edge Functions (Phase 7+)
│   │   ├── mpesa-stk-push/
│   │   ├── mpesa-callback/
│   │   ├── billing-cron/
│   │   ├── etims-submit/
│   │   └── send-sms/
│   └── tests/                 ← pgTAP tenant-isolation tests (Phase 2)
├── apps/web/                  ← Next.js PWA
│   └── src/{app,components,lib/{supabase,offline,i18n},features/{inventory,pos,customers,...}}
├── packages/types/            ← generated DB types (supabase gen types)
└── docs/
```

## 6. Phase 2 will add
JWT custom-claims hook, helper functions (`current_tenant_id()`, `has_role()`, `can_access_branch()`),
RLS policies for every table, triggers (stock_levels, sale totals, ledgers, audit), document-number generator,
and pgTAP tests proving cross-tenant access is impossible.

## 7. Applying the migrations
```
supabase init
# copy supabase/migrations/* and supabase/seed.sql into your project
supabase start
supabase db reset        # runs migrations + seed locally
supabase db push         # when ready to deploy to your cloud project
```

## 8. Phase 8 additions (Kenyan superpowers — see PHASE8_SETUP.md)
- **Tenancy columns:** tenants `etims_device_serial`, `etims_vscu_serial`, `etims_branch_code`, `etims_oscu_id`, `mpesa_till_number`, `mpesa_paybill_number`.
- **Products:** `aliases text[]` (GIN index, slang search), `aisle`/`rack`/`bin` (POS pick faces), `hs_code`, `etims_code`. `save_product` extended accordingly.
- **Customers:** `payment_terms_days` (0/7/14/30), `boda_stage`.
- **Sales:** `referred_by_customer_id` + `mechanic_commission_amount`/`_paid`; eTIMS CU fields (`etims_cu_number`, `etims_internal_data`, `etims_receipt_signature`, `etims_qr_payload`, retry metadata).
- **Payments:** `is_verified`/`verified_at`/`verified_by` — manual M-Pesa codes are unverified until an owner/manager confirms at end of day; STK-matched payments are auto-verified by the callback. Duplicate codes still blocked by `payments_mpesa_reference_unique`.
- **Cash sessions:** `counted_mpesa`, `mpesa_variance`, `counted_bank`, `bank_variance`; `close_cash_session_blind`/`session_totals_blind` hide expected figures until the blind count is entered.
- **Transfers:** `stock_transfer_items.discrepancy_note` — a note is mandatory for any line received short (`receive_transfer` enforces it).
- **Returns:** `sale_returns.return_type` (wrong_part/defective/warranty/exchange/customer_change) + `exchange_sale_id`.
- **New tables:** `mechanic_commissions` (unique per sale, owed/paid), `etims_queue` (unique per sale, queued/sending/submitted/failed, chronological retry with backoff).
- **Views:** `unverified_mpesa_payments`, `debt_aging`, `mechanic_commission_summary`, `etims_pending_queue`, refreshed `product_overview`/`customer_overview`.
- **RPCs:** `set_sale_referral`, `settle_mechanic_commissions`, `verify_mpesa_payment`, `queue_etims_invoice`, `etims_queue_summary`, `close_cash_session_blind`, `session_totals_blind`, `billing_status`, `debt_aging_summary`, `create_subscription_invoice`. `return_items`/`receive_goods`/`receive_transfer` extended (weighted-average costing on GRN).
- **Edge Functions:** `mpesa-stk-push` (POS + subscription, server-side amount from the invoice), `mpesa-callback` (idempotent STK + C2B auto-match, activates subscriptions from paid invoices only), `etims-submit` (readiness-mode stub until `ETIMS_BASE_URL` is set; otherwise KRA `/submitInvoice`).
- **Client:** `lib/i18n.ts` (EN/SW, localStorage + profile), `lib/mpesa.ts`, `lib/etims.ts`, `lib/search.ts` (offline slang/alias/bin search with Kenyan mechanic terms); NafPOS rebrand across landing/app; `/billing` in-app M-Pesa subscription page.
- **Rebrand:** single-shop name removed from public surfaces; the product is sold as **NafPOS** with Starter KES 1,000 / Growth KES 2,500 / Chain KES 6,000 and a 14-day trial.
