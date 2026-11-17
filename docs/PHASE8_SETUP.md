# Phase 8 setup — Kenyan superpowers, M-Pesa, eTIMS, blind cash-up, NafPOS rebrand

This phase is the big Kenyan one: STK Push from the POS, C2B auto-matching, offline M-Pesa
safeguards, KRA eTIMS readiness with a QR receipt, deni (debtors) with aging and itemized
WhatsApp reminders, fundi (mechanic) commissions, bin locations and slang search, inter-branch
transfers with discrepancy notes, weighted-average buying cost, blind cash-up with counted
M-Pesa, English/Kiswahili toggle — and the product is now **NafPOS**, sold as a subscription.

## 1. Database (terminal in the MAIN folder)
```
npx supabase db push --linked
```
Type `Y`. This sends migrations `21` to `26`:
| File | What it adds |
|---|---|
| `20261029000021_kenya_superpowers.sql` | customers `payment_terms_days`/`boda_stage`; products `aliases`/`aisle`/`rack`/`bin`/`hs_code`/`etims_code`; tenants eTIMS device + M-Pesa till/paybill; sales `referred_by_customer_id`/commission/eTIMS CU fields; payments `is_verified`; `cash_sessions.counted_mpesa`; `sale_returns.return_type`/`exchange_sale_id`; tables `mechanic_commissions`, `etims_queue`; views `unverified_mpesa_payments`, `debt_aging`, `mechanic_commission_summary`, `etims_pending_queue`; RPCs `set_sale_referral`, `settle_mechanic_commissions`, `verify_mpesa_payment`, `queue_etims_invoice`, `etims_queue_summary`, `close_cash_session_blind`, `session_totals_blind`, `billing_status`, `debt_aging_summary` |
| `20261029000022_save_product_kenya.sql` | `save_product` now accepts aliases, aisle/rack/bin, HS/eTIMS codes |
| `20261029000023_subscription_billing.sql` | `create_subscription_invoice(plan_code)` — billing must work even when the trial has lapsed |
| `20261029000024_return_types.sql` | `return_items` now takes `p_return_type` (`wrong_part`/`defective`/`warranty`/`exchange`/`customer_change`) and `p_exchange_sale_id`; the old 4-argument function is dropped |
| `20261029000025_receive_transfer_notes.sql` | `receive_transfer` requires a note for any line received short (`discrepancy_note`) |
| `20261029000026_weighted_average_cost.sql` | Goods receipt (GRN) now blends the price into the stock value instead of overwriting the buying price |
| `20261029000027_import_kenya.sql` | CSV/Excel import also carries shelf location, aisle/rack/bin, slang aliases and KRA HS/eTIMS codes |
| `20261117000028_subscription_invoice_self_heal.sql` | `create_subscription_invoice` self-heals a missing subscriptions row (expired Starter) instead of returning `invoice_id: null` |

Then in the SQL Editor run: `notify pgrst, 'reload schema';`

## 2. Edge Functions (terminal in the MAIN folder)
```
npx supabase functions deploy mpesa-stk-push --linked
npx supabase functions deploy mpesa-callback  --linked
npx supabase functions deploy etims-submit    --linked
```

### M-Pesa (Daraja) secrets
Supabase → Project Settings → Edge Functions → Secrets, add:
| Secret | Example | Notes |
|---|---|---|
| `MPESA_CONSUMER_KEY`, `MPESA_CONSUMER_SECRET` | from developer.safaricom.co.ke | Daraja app |
| `MPESA_SHORTCODE` | `174379` (sandbox) | Your paybill/till in production |
| `MPESA_PASSKEY` | sandbox passkey from the portal | |
| `MPESA_ENV` | `sandbox` or `production` | |
| `MPESA_CALLBACK_URL` | `https://<project>.supabase.co/functions/v1/mpesa-callback` | optional; defaults to this |

In the Daraja portal register your C2B Validation/Confirmation URLs as
`https://<project>.supabase.co/functions/v1/mpesa-callback/c2b`, then have the platform admin
insert each till/paybill into `tenant_mpesa_accounts` (shortcode, type, environment, branch) —
a small admin SQL step until the self-service shortcodes screen ships. Incoming payments then
auto-match to sales by receipt/reference. The STK callback path is `/mpesa-callback/stk`.

**How auto-matching works:** STK Push carries your sale (or invoice) in the account reference;
the callback matches `checkout_request_id` first, then `account_reference`/`receipt_no` for C2B.
Successful STK payments are recorded as **verified** payments; a manual 10-character code typed
by a cashier is stored **unverified** until an owner/manager taps "Verify" at end of day
(**Till → Verify M-Pesa codes**). Duplicate codes are rejected by a unique index.

### eTIMS (only when KRA onboards your shop)
Per-shop KRA settings live on the tenant row, not in env: `kra_pin`, `etims_device_serial`,
`etims_vscu_serial`, `etims_branch_code` (and `mpesa_till_number`/`mpesa_paybill_number` for
display). Set them in the SQL Editor, e.g.:
```sql
update public.tenants set kra_pin = 'P051234567X', etims_device_serial = 'KDS-…',
       etims_vscu_serial = 'VSCU-…', etims_branch_code = '00' where slug = 'your-shop';
```
Env vars (Supabase → Edge Functions → Secrets):
| Secret | Notes |
|---|---|
| `ETIMS_BASE_URL` | Your KRA eTIMS/OSCU endpoint. **Leave unset to run in readiness mode** |
| `ETIMS_DEVICE_SERIAL` | Optional fallback if a shop has no serial on its tenant row |

Until `ETIMS_BASE_URL` is set, `etims-submit` behaves exactly like the live one except it issues
a **stub CU number** (`CU-<receipt>-<attempt>`) so the whole flow — queue, retries, QR, receipt —
can be trained and tested. When you go live, set it and every queued invoice transmits in order.

## 3. What to try (15 minutes)
1. **Rebrand:** the site is now **NafPOS** ("Naf's POS"). Landing page sells the subscription:
   KES 1,000 Starter / KES 2,500 Growth / KES 6,000 Chain, 14-day trial.
2. **Sell screen:** type a slang word — `kenda`, `coil`, `piston ring`, `sprocket`, `kickstarter` —
   and matching tyres/coils/piston rings come up. Each result shows its **bin location**
   (e.g. "Aisle A · Rack B · Box 14"). Add a product with aliases in **Inventory → the product →
   Also known as**.
3. **M-Pesa from the POS:** enter the cart, tap **Send M-Pesa request (STK Push)**, type the
   customer's number — the prompt lands on their phone. Manual fallback: type the code
   (`SFK1A2B3C4`) — it is accepted but flagged **unverified** until the owner taps Verify on the Till page.
4. **Deni:** tag a sale to a garage customer with a credit limit and **Payment terms** (7/14/30 days)
   — the unpaid balance rides on their account. **Customers → Remind debtors** shows the
   **0–7 / 8–30 / 31–60 / 60+** buckets and a WhatsApp button per debtor that opens a message
   **itemising every unpaid invoice**. SMS reminders (plan Growth and above) work as before.
5. **Fundi commission:** at checkout pick the mechanic under **Referred by (fundi)** and enter
   the commission. **Customers → Fundi commissions** shows who is owed what and **Settle all**
   pays the running balance in one tap.
6. **eTIMS:** make a sale in a shop with a KRA PIN. The receipt shows the CU number (stub until
   KRA onboards you) with a scannable QR. Dashboard shows the **eTIMS queue**; queued invoices
   transmit oldest-first when you're online (it also retries automatically on reconnect).
7. **Blind cash-up:** open **Till**. The expected cash and M-Pesa totals are **hidden** while the
   shift is open. Enter what you counted — then the system reveals the variance and highlights
   shortages/overages in red/green.
8. **Transfers:** a short delivery now **requires a note** ("2 boxes damaged in transit"), stored
   on the transfer and in the stock movement.
9. **GRN:** receiving goods at a new price blends the buying price (weighted average) instead of
   overwriting it — profit reports stay honest.
10. **Returns:** each return gets a **type** (wrong part / defective / warranty / exchange /
    customer changed mind) and can restock or not — damaged goods never come back into stock.
11. **Language:** the **EN | SW** toggle in the top bar switches POS, nav, till and menus to
    Kiswahili. It is remembered on the device and on your profile.
12. **Billing:** sign up as owner → **Billing**. Pick Starter/Growth/Chain, enter your M-Pesa
    number, tap **Pay with M-Pesa** — the subscription activates automatically (invoice →
    STK Push → callback → active, grace cleared). Trial expiring? The billing page and the
    dashboard warn you before read-only mode kicks in.

## 4. Reliability rules (kept from earlier phases)
- Every money-affecting write is an RPC. Direct table writes stay revoked.
- Offline sales sync with `client_uuid` idempotency; the sync now also queues eTIMS and fundi
  commissions **after** the sale is accepted — stock, credit and codes can never double-post.
- Blind totals come from `session_totals_blind`, which strips expected figures while the till is open.
- `session_totals_blind` keeps `opening_float`, `sales_count`, `sales_total` and refunds/expenses
  visible — the cashier counted the float themselves.

## 5. Troubleshooting
| Problem | Fix |
|---|---|
| STK push never arrives | Daraja sandbox phone must be the registered test number; check secrets; check `MPESA_ENV` |
| Callback "not registered" | Register both C2B URLs and the STK callback in the Daraja console |
| "The invoice is missing" on Billing | Step 1 (migration 23) not run |
| Receipts show no QR | Sale was made before eTIMS fields existed, or the sale is voided; make a new sale |
| eTIMS card shows "failed" | Tap **Transmit now**; if it stays failed, the KRA endpoint is down — invoices keep retrying hourly |
| Kiswahili looks missing somewhere | Coverage is nav/POS/till/billing/customers for now; reports stay English except headings — translation is being widened every release |
