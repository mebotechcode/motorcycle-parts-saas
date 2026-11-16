# Phase 5a setup — Point of sale

## 1. Copy the new files into your project (PowerShell, one line at a time)
```
$dest = "D:\HOPE MAY-AUGUST 2026 WORK\HOPE MAY-AUGUST 2026 WORK\hope website\HOPE PROJECTS JS\motorcycle-parts-saas"
Expand-Archive -Path "$env:USERPROFILE\Downloads\motorcycle-parts-saas.zip" -DestinationPath "$env:USERPROFILE\Desktop\naf-update" -Force
Copy-Item -Path "$env:USERPROFILE\Desktop\naf-update\motorcycle-parts-saas\*" -Destination $dest -Recurse -Force
```
(If the zip has a different name, such as `motorcycle-parts-saas (1).zip`, use that name.)

## 2. Database
Supabase → SQL Editor → New query → paste all of `supabase\migrations\20261029000016_pos.sql` → Run.
It should say "Success. No rows returned."
(Terminal alternative, only if your Supabase terminal setup is done: in the MAIN folder run `npx supabase db push --linked`.)

Then run: `notify pgrst, 'reload schema';`

## 3. Tests (each: paste the whole file in a new SQL Editor query, Run; a red error with a report is expected; every line should start with ✅)
1. `supabase\tests\pos_test.sql`  ← the new one. Send me the report.
2. `supabase\tests\tenant_isolation_test.sql`  ← one line changed: cashiers can no longer insert sales by hand, so "cashier cannot insert sales directly" should now be ✅.

## 4. Restart the website
Ctrl + C in the window running the site, then in `apps\web`:
```
Remove-Item -Recurse -Force .next
npm run dev
```
Refresh with Ctrl + Shift + R.

## 5. Try it
1. Make sure you have a product with stock (Inventory).
2. **Sell** → type part of its name → tap it. Change the quantity with − / +.
3. Under **Payment** tap **All cash**, type the cash received (for example more than the total to see the change), then **Complete sale**.
4. You land on the receipt: **Print receipt**, **Send on WhatsApp**, **Copy text**.
5. Check **Sales** (today's list) and **Inventory** (stock went down).
6. **Credit:** as the owner add a customer with a credit limit (in Sell → + New customer), sell with only part paid, and see "On credit".
7. **Discount limit:** invite a cashier (Staff page). Cashiers can discount up to 5%. Try 10% and see the message. Prices below the product's "lowest allowed price" are refused for everyone except the owner.
8. **M-Pesa:** enter the amount and the transaction code from the customer's message. The same code cannot be used twice.
9. **Manager actions** (on a receipt, as owner/manager): **Take items back** (refund) and **Cancel this sale**.
10. **Till:** at the end of the day count the drawer. The system shows what should be there and any difference.

## Good to know
- M-Pesa codes typed by staff are recorded as "not yet verified". Automatic checking comes with the M-Pesa phase.
- Selling needs internet for now. Offline selling is the next part (5b).
- "Print receipt" uses the browser's print window. Choose your receipt printer there (80 mm paper works).
- Staff can no longer create or change sales, payments, returns or tills by hand: only through these screens.

## Troubleshooting
| Problem | Fix |
|---|---|
| Sell page shows "function ... does not exist" | Step 2 not run, then `notify pgrst, 'reload schema';` |
| "Your subscription is not active" | The 14-day trial ended. Tell me and I will show you how to extend it for testing |
| Cashier cannot find products | Check the product is Active and the cashier's branch has access |
| Any other red message | Send me the exact text |
