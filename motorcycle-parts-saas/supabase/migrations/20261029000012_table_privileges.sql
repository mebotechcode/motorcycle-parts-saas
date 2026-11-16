-- =====================================================================
-- Phase 2 / 12 — Table privileges for the API roles
--
-- Newer Supabase projects no longer give the "authenticated" role access to
-- new tables automatically. Row Level Security (migration 10) decides WHICH
-- rows a user may touch; these GRANTs only let the policies be evaluated.
-- "anon" (not logged in) deliberately gets nothing.
-- =====================================================================

grant usage on schema public to authenticated, service_role;

grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables    in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant usage, select on all sequences in schema public to authenticated;

-- same rules for tables created in later phases
alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public grant all on tables    to service_role;
alter default privileges in schema public grant all on sequences to service_role;
alter default privileges in schema public grant usage, select on sequences to authenticated;

-- ---- defence in depth: things users must NEVER write directly --------
-- (RLS already blocks these; this removes the permission as well)
revoke insert, update, delete on public.audit_logs         from authenticated;  -- written by triggers
revoke insert, update, delete on public.stock_levels       from authenticated;  -- maintained by trigger
revoke insert, update, delete on public.mpesa_transactions from authenticated;  -- written by Edge Functions
revoke all                    on public.document_sequences from authenticated;  -- via next_document_number()

-- append-only records: no editing or deleting once recorded
revoke update, delete on public.stock_movements  from authenticated;
revoke update, delete on public.payments         from authenticated;
revoke update, delete on public.customer_ledger  from authenticated;
revoke update, delete on public.supplier_ledger  from authenticated;
revoke update, delete on public.supplier_payments from authenticated;
