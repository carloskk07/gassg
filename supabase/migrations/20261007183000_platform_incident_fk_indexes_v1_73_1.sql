-- TAMÃO V1.73.1 — Platform incident FK indexes
-- Covers the remaining foreign keys reported by the Supabase performance advisor.

create index if not exists platform_incidents_created_by_idx
  on public.platform_incidents(created_by);

create index if not exists platform_incidents_acknowledged_by_idx
  on public.platform_incidents(acknowledged_by);

create index if not exists platform_incidents_resolved_by_idx
  on public.platform_incidents(resolved_by);
