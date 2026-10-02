-- Chama São Gabriel — PostgreSQL 17 MAINTAIN privilege hardening v1.27.1
-- PG17 added MAINTAIN to table ACLs. Do not let browser roles inherit it
-- on future public tables.

alter default privileges for role postgres in schema public
  revoke maintain on tables from anon, authenticated;
