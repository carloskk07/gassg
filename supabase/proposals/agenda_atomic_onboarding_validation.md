# Atomic onboarding validation and deployment record

- Isolated SQL acceptance and eight independent concurrent sessions passed in PR #1256, run 45749795287.
- Integrated frontend candidate passed all seven checks in PR #1257 at da041b57.
- Pinned Supabase CLI 2.122.0 generated migration filename 20261126034851_agenda_atomic_onboarding.sql and digest 484b2a5abd70699250ed15c8c7ec5b074e76342e21adcd69602cc5989bdd7a81 in run 45750615391.
- The same SQL was installed additively through the production migration API; the server assigned version 20261126035002. The repository uses that exact recorded version, not the earlier disposable filename.
- Read-only production verification: SECURITY INVOKER, search_path pg_catalog, anon EXECUTE false, authenticated EXECUTE true, zero agenda pages/services/hours before and after.

The historical proposal is retained only for provenance. The canonical migration is now the source of deployment truth. The SQL and concurrency tests must use the RPC installed by the disposable migration chain, not recreate or drop it. All fixtures are synthetic; single-session tests roll back and independent-session fixtures remain in the guarded disposable localhost stack destroyed by CI.

The final canonical-migration candidate must pass all release gates before frontend publication. Do not create synthetic records in production or modify financial settings.
