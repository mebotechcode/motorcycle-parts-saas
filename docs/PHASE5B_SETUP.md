# Phase 5b setup — Selling offline

## 1. Copy the new files into your project (PowerShell, one line at a time)
```
$dest = "D:\HOPE MAY-AUGUST 2026 WORK\HOPE MAY-AUGUST 2026 WORK\hope website\HOPE PROJECTS JS\motorcycle-parts-saas"
Expand-Archive -Path "$env:USERPROFILE\Downloads\motorcycle-parts-saas.zip" -DestinationPath "$env:USERPROFILE\Desktop\naf-update" -Force
Copy-Item -Path "$env:USERPROFILE\Desktop\naf-update\motorcycle-parts-saas\*" -Destination $dest -Recurse -Force
```
(If the zip has a different name, such as `motorcycle-parts-saas (1).zip`, use that name.)

## 2. Database
Open a terminal in the MAIN folder (`motorcycle-parts-saas`, not `apps\web`) and run:
```
npx supabase db push --linked
```
Type `Y`. It sends the new file `20261029000017_offline_sales.sql` (and any other file you have not applied yet).
Then in the Supabase SQL Editor run: `notify pgrst, 'reload schema';`

(No terminal? Paste the whole file `supabase\migrations\20261029000017_offline_sales.sql` into the SQL Editor and Run.)

## 3. Tests (paste each file into a new SQL Editor query; the red error with a report is expected; every line should start with ✅)
1. `supabase\tests\pos_offline_test.sql`  ← new
2. `supabase\tests\pos_test.sql`  ← run it again, because the sale function was updated

## 4. Check that normal selling still works
In `apps\web`: `npm run dev`, open http://localhost:3000, sign in, open **Sell**. You should see
"Prices & stock updated ..." at the top. Make a normal sale.

## 5. Try selling offline (needs the "built" version of the site)
The offline feature that opens pages without internet only runs in the built version.
1. Stop the dev site (Ctrl + C), then in `apps\web` run:
```
npm run build
npm run start
```
2. Open http://localhost:3000 in Chrome, sign in, open **Sell**, and wait for "Prices & stock updated".
3. Press **F12** → tab **Network** → change "No throttling" to **Offline**. (Or turn Wi-Fi off.)
4. Press **F5** to reload. The Sell page should still open.
5. Add a part, take payment, press **Save sale**. You get a receipt with a number like `NRB-D4F2-0001`.
   The amber bar at the top says you are offline.
6. Set the Network back to **No throttling**. Within about 30 seconds the bar changes to "Sending..." and disappears.
7. Open **Sales**: the sale is there with an **Offline** badge, and the stock went down.
8. If the sale broke a rule (for example a cashier gave a 10% discount), it also shows **Check**.
   Owner and managers open it and press **I have checked this sale**. Use the filter "Only sales that need a check".

To go back to normal development press Ctrl + C and run `npm run dev` again.
Remember: after changing code, run `npm run build` again before testing offline.

## What to know
- **First time:** open Sell once WITH internet so the parts list is saved on the device. After that it updates itself in the background.
- **Receipt numbers** made offline look like `NRB-D4F2-0001` (branch, device, running number) and stay the same after the sale is sent.
- **Rules while offline:** the goods are already sold, so the server records the sale even if it broke a rule, and flags it for the owner to check. Online sales stay strict.
- **Not possible offline:** adding new customers or products, returns, cancelling sales, and the till figures (they update when you reconnect).
- **Do not clear the browser's site data** while sales are waiting to be sent: they live on the device until sent. The bar at the top and the page **Sales → saved sales** (`/sales/queue`) show what is waiting.
- **Phones:** opening pages offline needs the site on `https` (your hosted website) or `localhost`. Over your home Wi-Fi address (http://192.168...) saving sales still works while the page is open, but a reload offline will not. Putting the site online fixes that.
- Installing: in Chrome open the menu and choose "Install app" / "Add to Home screen".

## Troubleshooting
| Problem | Fix |
|---|---|
| "This device has no saved parts list yet" | Connect to the internet, open Sell once, wait for "Prices & stock updated" |
| Page will not open offline in `npm run dev` | Expected. Offline page loading only works after `npm run build` + `npm run start` |
| `npm run build` fails | Send me the last 20 lines of the message |
| A saved sale shows "could not be sent" | Open **Saved sales**, read the reason, press Try again. If it persists tell me the message |
| Old version still showing | In Chrome press F12 → Application → Service Workers → Unregister, then Ctrl + Shift + R |
