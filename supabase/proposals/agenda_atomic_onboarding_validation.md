# Atomic onboarding acceptance gates
Candidate SQL is intentionally outside migrations. No production installation or browser switch is authorized by this proposal alone.

Run in a fresh disposable Supabase stack with the canonical migration chain. Generate the real migration with the installed Supabase CLI after testing. Verify database advisors and exposed RPC ACL.

Required cases:
- anonymous role cannot execute; anonymous authenticated JWT and unverified accounts denied;
- verified account creates one page, one service, exact week schedule, published state, all in one transaction;
- response loss/replay for same account returns existing page without mutating it, even with changed submitted fields;
- existing draft stays private and intact; browser must open editor rather than report success;
- concurrent calls for same owner: exactly one page and one initial service;
- duplicate slug across owners: failed transaction leaves no page, service or hours; client retries only a confirmed slug collision;
- deliberately inject a test-only trigger that raises on hours insert; confirm no page, service, or hours survive;
- role grants unchanged except authenticated execute of new invoker function; RLS still applies;
- no existing booking, finance, catalog, or storage data changed;
- browser compatibility: old release works before/after additive RPC deployment; new release independently confirms owner page/service/hours/publication and never falls back to writes after ambiguous RPC failure.

All data must be synthetic. The single-session acceptance test rolls back its function and fixtures. The independent-session concurrency test commits synthetic fixtures only in the guarded disposable localhost stack, removes the candidate RPC in finally, and relies on stack destruction for fixture cleanup. Do not install candidate in hosted production. Final migration and frontend integration require a new validated release.

Automated entrypoints: `tests/sql/agenda-mvp-invariants.sql` includes the rollback-only candidate acceptance test; `tests/isolated-agenda-concurrency.mjs` includes the eight-session race. The latter requires CI, the disposable concurrency flag, blank hosted Supabase credentials, and a fixed loopback database endpoint. No hosted database test is intended.
