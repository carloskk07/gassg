-- Chama São Gabriel — lock default Data API privileges v1.27
-- Future objects created by postgres in public must remain server-only by default.
-- Explicit grants are required for any browser-facing object.

alter default privileges for role postgres in schema public
  revoke select, insert, update, delete, truncate, references, trigger on tables from anon, authenticated;

alter default privileges for role postgres in schema public
  revoke usage, select, update on sequences from anon, authenticated;

alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;

alter default privileges for role postgres in schema public
  grant select, insert, update, delete, truncate, references, trigger on tables to service_role;

alter default privileges for role postgres in schema public
  grant usage, select, update on sequences to service_role;

alter default privileges for role postgres in schema public
  grant execute on functions to service_role;
