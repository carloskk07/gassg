-- TAMÃO V1.223.1 — cover new private foreign keys reported by Supabase linter.
-- Metadata-only performance hardening; no row changes, new grants or permissions.
create index if not exists portal_attestation_observations_episode_fk_v1_223_1
 on tamao_internal.portal_attestation_observations_v1_223(episode_id);
create index if not exists portal_attestation_state_episode_fk_v1_223_1
 on tamao_internal.portal_attestation_state_v1_223(active_episode_id);
