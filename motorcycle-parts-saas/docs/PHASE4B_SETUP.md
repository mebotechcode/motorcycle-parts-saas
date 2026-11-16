# Phase 4b setup — Stock transfers and Excel import

Do the steps in this order. Steps 2 and 3 are only needed if you have not yet done Phase 4a.

## 1. Copy the new files into your project (PowerShell, one line at a time)
```
$dest = "D:\HOPE MAY-AUGUST 2026 WORK\HOPE MAY-AUGUST 2026 WORK\hope website\HOPE PROJECTS JS\motorcycle-parts-saas"
Expand-Archive -Path "$env:USERPROFILE\Downloads\motorcycle-parts-saas.zip" -DestinationPath "$env:USERPROFILE\Desktop\naf-update" -Force
Copy-Item -Path "$env:USERPROFILE\Desktop\naf-update\motorcycle-parts-saas\*" -Destination $dest -Recurse -Force
```
(If the zip has a different name, such as `motorcycle-parts-saas (1).zip`, use that name.)

## 2. Phase 4a database file (skip if already done)
Supabase → SQL Editor → New query → paste all of `supabase\migrations\20261029000014_inventory.sql` → Run.
Then run `supabase\tests\inventory_test.sql` the same way (red error with a report is expected; every line should start with ✅).

## 3. Phase 4b database file
Supabase → SQL Editor → New query → paste all of `supabase\migrations\20261029000015_transfers_import.sql` → Run.
It should say "Success. No rows returned."

Terminal alternative (only if your Supabase terminal setup is done): in the MAIN folder run `npx supabase db push --linked`.

## 4. Run the Phase 4b test
SQL Editor → New query → paste all of `supabase\tests\transfers_import_test.sql` → Run.
Expect the red error with the report. Every line should start with ✅. Send me the report.

## 5. Refresh Supabase and restart the website
In the SQL Editor run: `notify pgrst, 'reload schema';`
In the window running the site press Ctrl + C, then in `apps\web`:
```
Remove-Item -Recurse -Force .next
npm run dev
```
Refresh the browser with Ctrl + Shift + R.

## 6. Try the import
1. **Inventory → Import from Excel → Download template.**
2. Open it in Excel, replace the sample rows with a few of your own parts, and save as **CSV UTF-8 (Comma delimited)**.
3. Choose the file, check the preview, pick the branch that holds the stock, then **Import**.
4. Import the same file again with **Update products that already exist** ticked and change a price: only the price changes.

## 7. Try transfers (you need two branches)
1. **Branches → Add a branch** (the Starter plan allows only 1 branch. To test, change the plan limit in Supabase, or ask me how).
2. **Transfers → + New transfer:** choose the branches, search a product, enter a quantity, **Send transfer**.
3. The stock leaves the sending branch immediately.
4. Open the transfer as a person with access to the receiving branch, enter what arrived, **Confirm received**.
5. Try receiving less than was sent: the difference is recorded as lost.

## What is new in the database
- Transfers can only be changed through safe functions (send, receive, cancel), never edited by hand.
- A transfer cannot send more than the branch has, and each person only acts for their own branches.
- Plan limit on products (Starter 2,000, Growth 20,000). A friendly message appears when it is reached.

## Troubleshooting
| Problem | Fix |
|---|---|
| "function ... does not exist" on the pages | Step 3 was not run, then run `notify pgrst, 'reload schema';` |
| Import says "Only the owner, managers and storekeepers..." | Sign in as one of those roles |
| Excel file will not load | Save it as CSV UTF-8 first (File → Save As) |
| Fits column shows "Bike not found" | Add that bike on any product page (Can't find the bike? Add it), then import again |
