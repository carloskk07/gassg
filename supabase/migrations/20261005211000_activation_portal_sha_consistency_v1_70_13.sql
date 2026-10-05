-- TAMÃO V1.70.13 — bind live activation to the exact portal attestation SHA.
-- A live re-probe in admin-ops supplies mode_source_sha. The database rejects
-- activation if that SHA differs from the last recorded three-portal attestation.

alter table public.platform_launch_control
  drop constraint if exists platform_launch_control_mode_source_consistency;

alter table public.platform_launch_control
  add constraint platform_launch_control_mode_source_consistency
  check (
    not commerce_enabled
    or (
      portals_source_sha is not null
      and mode_source_sha is not null
      and mode_source_sha = portals_source_sha
    )
  );
