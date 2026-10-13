-- V1.211 supplemental indexing: cover admin identity foreign keys used on reassignment/deletion.
create index if not exists admin_alert_followups_owner_v1_211
 on public.admin_alert_followups_v1_211(owner_id);
create index if not exists admin_alert_followups_updated_by_v1_211
 on public.admin_alert_followups_v1_211(updated_by);
create index if not exists admin_alert_followup_events_actor_v1_211
 on public.admin_alert_followup_events_v1_211(actor_user_id)
 where actor_user_id is not null;
