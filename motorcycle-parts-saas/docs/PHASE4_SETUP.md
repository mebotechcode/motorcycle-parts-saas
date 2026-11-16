# Phase 4a setup — Inventory (products and stock)

## A. Copy the new files into your project (PowerShell, one line at a time)
```
$dest = "D:\HOPE MAY-AUGUST 2026 WORK\HOPE MAY-AUGUST 2026 WORK\hope website\HOPE PROJECTS JS\motorcycle-parts-saas"
Expand-Archive -Path "$env:USERPROFILE\Downloads\motorcycle-parts-saas.zip" -DestinationPath "$env:USERPROFILE\Desktop\naf-update" -Force
Copy-Item -Path "$env:USERPROFILE\Desktop\naf-update\motorcycle-parts-saas\*" -Destination $dest -Recurse -Force
```
If the zip in Downloads has a different name (for example `motorcycle-parts-saas (1).zip`), use that name.
Your `.env.local` and `node_modules` are not touched.

## B. Put the new database file on Supabase
**If your Supabase terminal setup (login + link) is done**, open a terminal in the MAIN folder and run:
```
npx supabase db push --linked
```
Type `Y` when asked. It sends only the new file `20261029000014_inventory.sql`.

**If you have not set up the terminal yet**, open the file `supabase\migrations\20261029000014_inventory.sql` in Notepad,
copy everything, and paste it into Supabase → SQL Editor → New query → Run.

## C. Run the test
Supabase → SQL Editor → New query → paste all of `supabase\tests\inventory_test.sql` → Run.
A red error with a report appears (expected). Every line should start with ✅. Send me the report.

## D. Restart the website
In the window running the site press Ctrl + C, then (inside `apps\web`):
```
Remove-Item -Recurse -Force .next
npm run dev
```
Refresh the browser with Ctrl + Shift + R.

## E. Try it
1. Click **Inventory** (menu ☰ on a phone) → **+ Add product**.
2. Fill the name, a selling price, and the buying price. Choose a category. Click **+ New brand** to add one.
3. Under **Fits these bikes** choose a make, tick the models. Not in the list? Use **Can't find the bike? Add it**.
4. Type an opening stock number and pick the branch. **Save product**.
5. On the product page, use **Change stock**: *Stock count*, *Add stock* or *Damaged / lost*. Check **Recent movements**.
6. Back on the list, try the search box, the filters and **Running low**.
7. Invite a cashier (Staff page) and sign in as them: they can see products and prices, but never the buying price, and cannot edit or change stock.

## What changed in the database
- Buying price and "lowest price allowed" moved to a private table that cashiers cannot read.
- Staff can only record opening stock, count corrections and damage/loss by hand; purchases and sales will come from their own screens.
- Every price change and stock correction is written to the audit log with the person's name.

## Troubleshooting
| Problem | Fix |
|---|---|
| Migration fails with "already exists" | Send me the exact message |
| "permission denied for table ..." | Run `20261029000012_table_privileges.sql` again |
| Inventory page shows an error in red | Send me the exact message |
| No bikes in the list | Run `supabase\seed.sql` once, or add bikes with "Can't find the bike? Add it" |
