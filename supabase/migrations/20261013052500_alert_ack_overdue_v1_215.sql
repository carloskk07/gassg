-- TAMÃO V1.215 — evidence of missed owner acknowledgement, independently scheduled.
-- An overdue acknowledgement is not a resolved incident, notification, or reassignment.
alter table public.admin_alert_followup_events_v1_211
  drop constraint admin_alert_followup_events_v1_211_event_kind_check;
alter table public.admin_alert_followup_events_v1_211
  add constraint admin_alert_followup_events_v1_211_event_kind_check
  check(event_kind in
    ('created','updated','closed','reopened','overdue','acknowledged','ack_overdue'));

create unique index if not exists admin_alert_ack_overdue_once_v1_215
 on public.admin_alert_followup_events_v1_211(source,revision)
 where event_kind='ack_overdue';

create or replace function tamao_internal.record_alert_ack_overdue_v1_215()
returns integer language plpgsql volatile security invoker
set search_path=pg_catalog
as $fn$
declare
  v_count integer;
begin
  if session_user<>'postgres' then
    raise exception 'ALERT_ACK_CRON_ONLY' using errcode='42501';
  end if;
  insert into public.admin_alert_followup_events_v1_211
    (source,event_kind,revision,actor_user_id,owner_id,due_at,status)
  select f.source,'ack_overdue',f.revision,null,f.owner_id,f.due_at,f.status
  from public.admin_alert_followups_v1_211 f
  join public.platform_admins owner
    on owner.user_id=f.owner_id and owner.active
  where f.status<>'closed'
    and public.admin_alert_source_allowed_v1_211(owner.admin_role,f.source,true)
    and f.updated_at<=clock_timestamp()-interval '2 hours'
    and not exists (
      select 1 from public.admin_alert_followup_events_v1_211 e
      where e.source=f.source and e.revision=f.revision
        and e.event_kind='acknowledged' and e.actor_user_id=f.owner_id
    )
  on conflict (source,revision) where event_kind='ack_overdue' do nothing;
  get diagnostics v_count=row_count;
  return v_count;
end;
$fn$;
revoke all on function tamao_internal.record_alert_ack_overdue_v1_215()
 from public,anon,authenticated,service_role;

do $schedule$
begin
  if not exists(select 1 from cron.job
    where jobname='tamao-alert-ack-overdue-v1-215') then
    perform cron.schedule('tamao-alert-ack-overdue-v1-215',
      '23 * * * *',
      'select tamao_internal.record_alert_ack_overdue_v1_215();');
  end if;
end;
$schedule$;
