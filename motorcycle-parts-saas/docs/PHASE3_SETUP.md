# Phase 3 setup — step by step (Windows)

Phase 3 adds: sign up, create your shop, invite staff by link, branches, and the first screens in the Naf's colours.

## A. Get the files in the right place
1. Download `motorcycle-parts-saas.zip`.
2. Right-click it → **Extract All...** → choose your **Documents** folder.
3. If Windows asks about files that already exist, choose **Replace**.
You now have `Documents\motorcycle-parts-saas` with new folders `apps\web`, `brand`, `docs`, `supabase`.

## B. Database (Supabase website)
1. SQL Editor → New query → paste `supabase/migrations/20261029000013_onboarding_staff_rpcs.sql` → **Run**.
2. SQL Editor → New query → paste `supabase/tests/onboarding_test.sql` → **Run**.
   A red error with a report appears (expected). Every line should start with ✅. If one has ❌, send me the report.
3. Make sure the login hook is enabled: **Authentication → Hooks → Custom Access Token → public.custom_access_token_hook**.
4. For testing, turn off email confirmation so sign-up works instantly:
   **Authentication → Sign In / Providers → Email → switch OFF "Confirm email" → Save**.
   (Turn it back on before real customers use the system.)

## C. Install Node.js (one time)
1. Go to **nodejs.org**, download the **LTS** version, and install it (keep clicking Next).
2. Close any open Command Prompt windows.

## D. Start the website on your computer
1. Open File Explorer → `Documents\motorcycle-parts-saas\apps\web`.
2. Click the address bar at the top, type `cmd`, press **Enter**. A black window opens in that folder.
3. Type this and press Enter (takes a few minutes, needs internet):
   `npm install`
4. Create your settings file. Type:
   `copy .env.local.example .env.local`
   then: `notepad .env.local`
5. In Supabase open **Project Settings → API** (or click **Connect**). Copy the **Project URL** and the **anon / publishable key** into Notepad, replacing the placeholder text. Save and close Notepad.
   Never use the `service_role` / secret key here.
6. Back in the black window type:
   `npm run dev`
7. Open your browser at **http://localhost:3000**.
To stop the website press **Ctrl + C** in the black window. To start it again later, repeat steps 2 and 6 only.

## E. Try it
1. **Create account** → fill the form.
2. **Set up your shop** → business name, branch name, branch code (e.g. NRB).
3. You land on the dashboard with the 14-day trial.
4. **Staff → Invite someone** → enter an email, choose Cashier → copy the link.
5. Open the link in a private/incognito window, sign up with that same email, and you join as a cashier.

## Troubleshooting
| Problem | Fix |
|---|---|
| `npm is not recognized` | Install Node.js (step C), close the black window, open a new one |
| Red screen "Missing Supabase settings" | `.env.local` is missing or has no values. Redo step D4–D5, then stop (Ctrl + C) and run `npm run dev` again |
| After creating the shop you see a message about the "login hook" | Enable the hook (step B3), then sign out and sign in again |
| "Invalid login credentials" right after sign-up | Email confirmation is still ON (step B4) |
| Any other error | Copy the full message and send it to me |

## Folder layout now
```
motorcycle-parts-saas/
├── apps/web/          (the website)
├── brand/
├── docs/
└── supabase/
    ├── seed.sql
    ├── migrations/    (13 files)
    └── tests/         (2 test files)
```
