# Phase 6a setup — Customers on credit

## 1. Copy the new files into your project (PowerShell, one line at a time)
```
$dest = "D:\HOPE MAY-AUGUST 2026 WORK\HOPE MAY-AUGUST 2026 WORK\hope website\HOPE PROJECTS JS\motorcycle-parts-saas"
Expand-Archive -Path "$env:USERPROFILE\Downloads\motorcycle-parts-saas.zip" -DestinationPath "$env:USERPROFILE\Desktop\naf-update" -Force
Copy-Item -Path "$env:USERPROFILE\Desktop\naf-update\motorcycle-parts-saas\*" -Destination $dest -Recurse -Force
```
(If the zip has a different name, such as `motorcycle-parts-saas (1).zip`, use that name.)

## 2. Database
Open a terminal in the MAIN folder (`motorcycle-parts-saas`, not `apps\web`):
```
npx supabase db push --linked
```
Type `Y`. It sends the new file `20261029000018_customers_credit.sql`.
Then in the Supabase SQL Editor run: `notify pgrst, 'reload schema';`
(No terminal? Paste the whole file into the SQL Editor and Run.)

## 3. Test
SQL Editor → New query → paste all of `supabase\tests\customers_test.sql` → Run.
A red error with a report is expected. Every line should start with ✅. Send me the report.

## 4. Restart the website
Ctrl + C in the window running the site, then in `apps\web`: `npm run dev`. Refresh with Ctrl + Shift + R.

## 5. Try it
1. **Customers** (menu): add a customer with a phone number. As the owner, give them a **credit limit** (for example 5,000).
2. **Sell**: pick the customer, add parts, pay less than the total (or nothing). The rest goes **on credit**.
3. Open the customer: you see what they owe, their limit, and the **statement**.
4. **Receive a payment** (cash / M-Pesa with code / bank). It pays their oldest sales first.
   Try paying more than they owe: the extra stays as **credit on the account**.
5. **Manager tools:** add **old debt** from your notebook (opening balance), **write off** a bad debt (needs a reason), or correct a mistake.
6. **Remind debtors** (button on the Customers page): see debts by age, tick customers, and send a **WhatsApp** message with one tap, or **SMS** (Growth/Chain plans, see below).
7. The dashboard shows **Customers owe you** and today's sales.

## Optional: SMS reminders (Africa's Talking)
WhatsApp buttons work with no setup. For SMS:
1. Create an account at **africastalking.com** and an app. Note your **username** and **API key** (the sandbox username is `sandbox`).
2. In the MAIN folder run this as ONE line (use your own values; keep `AT_SANDBOX=true` while testing):
```
npx supabase secrets set AT_USERNAME=sandbox AT_API_KEY=PASTE-YOUR-KEY AT_SANDBOX=true
```
3. Deploy the function:
```
npx supabase functions deploy send-sms --no-verify-jwt
```
(If it complains about Docker, add `--use-api` at the end.)
4. When it works in the sandbox, run again with your live username and key and `AT_SANDBOX=false`.
   A "sender ID" (your shop name instead of a number) is optional and must be registered with Africa's Talking: add `AT_SENDER_ID=YOURNAME` once approved.
5. SMS is allowed on the Growth and Chain plans. On Starter the page shows only the WhatsApp option.
Check Africa's Talking for current prices before sending to many customers.

## Good to know
- Cashiers can add customers and receive payments, but cannot set or raise credit limits, add old debt, or write off debt.
- Every old-debt entry and write-off is recorded in the audit log with the person's name.
- A payment is spread over the oldest unpaid sales. Extra money stays as credit on the account and lowers the balance, but old sales may still show "owes" until a later payment is applied to them.
- Receiving payments needs internet (offline selling still works as before).

## Troubleshooting
| Problem | Fix |
|---|---|
| "function ... does not exist" | Step 2 not run, then `notify pgrst, 'reload schema';` |
| Customers page shows a red error | Send me the exact message |
| SMS says "not set up" | Do the secrets and deploy steps above |
| SMS says "Growth and Chain plans" | Your shop is on Starter. Use WhatsApp or change the plan for testing |
