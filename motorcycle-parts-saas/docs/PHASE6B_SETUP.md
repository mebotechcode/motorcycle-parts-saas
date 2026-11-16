# Phase 6b setup — Suppliers and purchases

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
Type `Y`. It sends `20261029000019_purchasing.sql`.
Then in the Supabase SQL Editor run: `notify pgrst, 'reload schema';`

## 3. Test
In the main folder: `notepad supabase\tests\suppliers_test.sql`, then Ctrl + A, Ctrl + C, close Notepad.
Supabase → SQL Editor → New query → Ctrl + V → Run.
A red error with a report is expected. Every line should start with ✅. Send me the report.

## 4. Restart the website
In a window sitting in `apps\web`: Ctrl + C, then `npm run dev`. Refresh with Ctrl + Shift + R.

## 5. Try it
1. **Purchases** (menu) → **Suppliers** → **+ Add supplier** (name, phone, days to pay).
2. If you owe a supplier from before, open the supplier → **Add old debt (opening balance)**.
3. **Purchases → + New order:** pick the supplier and branch, search products (or press **Add running-low items**), set quantities and prices.
   **Save and mark as ordered.** You can send the order on WhatsApp.
4. When the goods arrive: **Receive goods** → pick the order. The quantities fill in. Change what actually arrived, add the supplier's invoice number.
   Watch the price warnings ("Price up 8%", "no profit").
5. As owner/manager you can **pay now** (full or part). The rest is added to what you owe the supplier.
6. **Save delivery.** Check: stock went up (Inventory), the product's buying price is the new one, and the order shows "Part received" or "Received".
7. Open the supplier: you see **what you owe**, the statement, deliveries, and **Pay this supplier** (M-Pesa, cash, bank).
8. Open a product (Inventory) and scroll to **Buying history**: every delivery with the price and the change.
9. **Return goods** (on the supplier page): stock goes down and you owe less.

## What changed
- "Transfers" and "Till" are no longer in the top menu: open Transfers from the Inventory page, and Till from the Sales page. **Purchases** is now in the menu.
- Stock can only be added from purchases through **Receive goods** (not by hand), so stock, prices and what you owe always agree.
- Storekeepers can order, receive and return goods. Only the owner and managers can pay suppliers, see what is owed, and change balances.
- The dashboard shows **You owe suppliers** for the owner and managers.

## Good to know
- Recording a supplier payment does not move money. If you pay a supplier in cash from the till, also record it as an expense so the till figures stay right (expenses screen comes later).
- The "latest buying price" is the price of the most recent delivery. It is what profit is worked out from.
- Receiving goods needs internet.

## Troubleshooting
| Problem | Fix |
|---|---|
| "function ... does not exist" | Step 2 not run, then `notify pgrst, 'reload schema';` |
| Purchases page not in the menu | Only the owner, managers and storekeepers see it |
| "That order does not match this supplier and branch" | Receive at the same branch the order was made for |
| Any other red message | Send me the exact text |
