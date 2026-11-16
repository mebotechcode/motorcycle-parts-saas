# Phase 2 setup — step by step

## A. Run the 4 new migrations (same way as Phase 1)
In Supabase: **SQL Editor → New query**. For each file, open it in Notepad, copy everything, paste, click **Run**. In this order:
1. `20261029000009_auth_helpers_claims.sql`
2. `20261029000010_rls_policies.sql`
3. `20261029000011_triggers_core.sql`
4. `20261029000012_table_privileges.sql`  (fixes "permission denied for table" errors)

Save them in your `supabase/migrations` folder too.

## B. Turn on the login hook (required — do not skip)
This makes the app know which shop and role each user has.
1. Supabase dashboard → **Authentication** → **Hooks** (some versions call it "Auth Hooks").
2. Find **Custom Access Token** and click **Add hook** (or enable it).
3. Choose hook type **Postgres function**, schema **public**, function **custom_access_token_hook**.
4. Save.

## C. Run the test
1. Save `supabase/tests/tenant_isolation_test.sql` in your project (create the `tests` folder).
2. SQL Editor → New query → paste the whole file → **Run**.
3. You will see a red **error**. That is expected. Read the report inside it:
   every line should start with ✅. Any ❌ → copy the report to Claude.

## D. Where each new file goes
Inside your `motorcycle-parts-saas` folder, create these new folders if they do not exist yet: `brand` and `supabase/tests`.

| File | Put it in |
|---|---|
| `20261029000009_auth_helpers_claims.sql` | `supabase/migrations` |
| `20261029000010_rls_policies.sql` | `supabase/migrations` |
| `20261029000011_triggers_core.sql` | `supabase/migrations` |
| `20261029000012_table_privileges.sql` | `supabase/migrations` |
| `tenant_isolation_test.sql` | `supabase/tests` |
| `naf-logo.png`, `brand.css`, `BRAND.md` | `brand` |
| `PHASE2_SETUP.md` | `docs` |

Final result:
```
motorcycle-parts-saas/
├── brand/
│   ├── naf-logo.png
│   ├── brand.css
│   └── BRAND.md
├── docs/
│   ├── ARCHITECTURE.md
│   └── PHASE2_SETUP.md
└── supabase/
    ├── seed.sql
    ├── migrations/   (12 files, numbered 01 to 12)
    └── tests/
        └── tenant_isolation_test.sql
```

## Good to know
- Role or branch changes only reach a user's token when it refreshes (about every hour, or at next login).
  The app will force a refresh after you change someone's role (Phase 3).
- The SaaS owner (platform admin) can READ every shop's data for support, but can only WRITE plans, tenants and billing.
- Negative stock is allowed on purpose (shops often sell before entering a delivery). A "block negative stock" setting can be added later.
