# Phase 7 setup — Expenses and reports

## 1. Copy the new files into your project (PowerShell, one line at a time)
```
$dest = "D:\HOPE MAY-AUGUST 2026 WORK\HOPE MAY-AUGUST 2026 WORK\hope website\HOPE PROJECTS JS\motorcycle-parts-saas"
Expand-Archive -Path "$env:USERPROFILE\Downloads\motorcycle-parts-saas.zip" -DestinationPath "$env:USERPROFILE\Desktop\naf-update" -Force
Copy-Item -Path "$env:USERPROFILE\Desktop\naf-update\motorcycle-parts-saas\*" -Destination $dest -Recurse -Force
```
(If the zip has a different name, such as `motorcycle-parts-saas (1).zip`, use that name.)

## 2. Database (terminal in the MAIN folder, not apps\web)
```
cd "D:\HOPE MAY-AUGUST 2026 WORK\HOPE MAY-AUGUST 2026 WORK\hope website\HOPE PROJECTS JS\motorcycle-parts-saas"
npx supabase db push --linked
```
Type `Y`. It sends the new file(s) after 18 (this phase is `20261029000020_expenses_reports.sql`, and `20261029000019_purchasing.sql` if you have not sent it yet).
Then in the Supabase SQL Editor run: `notify pgrst, 'reload schema';`

## 3. Tests
In the main folder: `notepad supabase\tests\reports_test.sql`, Ctrl + A, Ctrl + C, close Notepad.
Supabase → SQL Editor → New query → Ctrl + V → Run.
A red error with a report is expected. Every line should start with ✅. Send me the report.
(If you have not run the Phase 6b test yet, do the same with `suppliers_test.sql` and send me that report too.)

## 4. Restart the website
In a window sitting in `apps\web`: Ctrl + C, then `npm run dev`. Refresh with Ctrl + Shift + R.

## 5. Try it
1. **Sales → Expenses** (or the link on the Till page): add an expense, for example "Transport" KES 200, paid in **Cash**.
   Cash expenses are taken out of your till: open **Till** and see "Cash expenses" and a lower "should be in the drawer".
2. Add an M-Pesa expense too (it does not touch the till).
3. **Reports** (menu, owner and managers): pick a period.
   - **Overview:** sales, gross profit, expenses, **net profit**, money received by method, credit given, expenses by category, and a day-by-day chart and table.
   - **Products:** best sellers (by money, number sold, or profit) and **slow-moving stock** (money tied up in items not sold for 30 to 180 days).
   - **Stock:** what your stock is worth at cost and at selling prices, by category.
   - **Team & branches:** sales and discounts per staff member, and each branch compared.
   - Every table has **Download CSV** (opens in Excel).
4. Pay a supplier in cash: on the supplier page tick **Paid from the till drawer**. The till figures drop by that amount.
5. The **dashboard** now shows **Profit today** for the owner and managers.

## How the numbers work
- **Sales** leave out cancelled sales. Refunds for returned items are taken off.
- **Cost of goods** is the buying price saved on each sale line at the time of the sale. If a product had no buying price, its cost counts as 0, so add buying prices to products for true profit.
- **Net profit** = sales after returns - cost of goods - expenses.
- Dates use Kenya time. "Today" runs from midnight to midnight Kenya time.
- A cash refund comes out of the till of the person who gave it.

## Good to know
- Cashiers can record today's expenses only (no back-dating) and see only their own. Owner and managers can pick any date, see all, and delete an expense with a reason (kept in the audit log).
- Reports are for the owner and managers only because they show costs and profit.
- Expenses and reports need internet.

## Troubleshooting
| Problem | Fix |
|---|---|
| "function ... does not exist" | Step 2 not run, then `notify pgrst, 'reload schema';` |
| Reports show zeros | Check the period. Make a sale today, then press the refresh in your browser |
| Profit looks too high | Products without a buying price count as 0 cost. Add buying prices |
| Any red message | Send me the exact text |
