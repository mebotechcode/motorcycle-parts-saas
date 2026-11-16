-- =====================================================================
-- Phase 1 / 08 — updated_at triggers + RLS default-deny
-- Row Level Security is switched ON for every table now, with NO policies.
-- Until Phase 2 adds policies, the API (anon/authenticated) can read and
-- write nothing, so no tenant data can leak while the build is in progress.
-- (service_role and the SQL editor bypass RLS.)
-- =====================================================================

do $$
declare r record;
begin
  -- attach set_updated_at to every table that has an updated_at column
  for r in
    select c.table_name
    from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema and t.table_name = c.table_name
    where c.table_schema = 'public'
      and c.column_name  = 'updated_at'
      and t.table_type   = 'BASE TABLE'
  loop
    execute format('drop trigger if exists trg_set_updated_at on public.%I', r.table_name);
    execute format(
      'create trigger trg_set_updated_at before update on public.%I
         for each row execute function public.set_updated_at()', r.table_name);
  end loop;

  -- enable RLS on every table in public
  for r in
    select tablename from pg_tables where schemaname = 'public'
  loop
    execute format('alter table public.%I enable row level security', r.tablename);
  end loop;
end $$;
