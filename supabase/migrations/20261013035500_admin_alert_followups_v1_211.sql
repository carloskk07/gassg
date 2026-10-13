-- TAMÃO V1.211 — human-approved alert follow-ups (not source incident mutation).
-- One durable work item per aggregate source. Strict role-scoped service-role RPC.
create table if not exists public.admin_alert_followups_v1_211(
  source text primary key check(source in ('incidents','support','finance','capture')),
  owner_id uuid not null references public.platform_admins(user_id) on delete restrict,
  due_at timestamptz not null,
  status text not null default 'open' check(status in ('open','monitoring','closed')),
  note text not null check(char_length(btrim(note)) between 6 and 240),
  revision integer not null default 1 check(revision>=1),
  updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp()
);
alter table public.admin_alert_followups_v1_211 enable row level security;
revoke all on public.admin_alert_followups_v1_211 from public,anon,authenticated;
grant select,insert,update on public.admin_alert_followups_v1_211 to service_role;

create table if not exists public.admin_alert_followup_events_v1_211(
  id bigint generated always as identity primary key,
  source text not null references public.admin_alert_followups_v1_211(source) on delete restrict,
  event_kind text not null check(event_kind in ('created','updated','closed','reopened','overdue')),
  revision integer not null check(revision>=1),
  actor_user_id uuid references auth.users(id) on delete restrict,
  owner_id uuid not null,
  due_at timestamptz not null,
  status text not null check(status in ('open','monitoring','closed')),
  recorded_at timestamptz not null default clock_timestamp()
);
create unique index if not exists admin_alert_overdue_one_per_revision_v1_211
 on public.admin_alert_followup_events_v1_211(source,revision)
 where event_kind='overdue';
create index if not exists admin_alert_followup_events_time_v1_211
 on public.admin_alert_followup_events_v1_211(recorded_at desc,id desc);
alter table public.admin_alert_followup_events_v1_211 enable row level security;
revoke all on public.admin_alert_followup_events_v1_211 from public,anon,authenticated;
grant select,insert on public.admin_alert_followup_events_v1_211 to service_role;
grant usage on sequence public.admin_alert_followup_events_v1_211_id_seq to service_role;

-- A strict reusable role-scoped source predicate; callable only by postgres and service_role.
create or replace function public.admin_alert_source_allowed_v1_211(
 p_role text,p_source text,p_write boolean
) returns boolean language sql immutable security invoker
set search_path=pg_catalog
as $fn$
 select case
 when p_source='finance' then p_role in ('superadmin','finance')
 when p_source='capture' then p_role in ('superadmin','operations')
   or (not p_write and p_role in ('compliance','readonly'))
 when p_source='support' then p_role in ('superadmin','operations','support')
 when p_source='incidents' then p_role in ('superadmin','operations','support')
   or (not p_write and p_role in ('finance','compliance','readonly'))
 else false end;
$fn$;
revoke all on function public.admin_alert_source_allowed_v1_211(text,text,boolean)
 from public,anon,authenticated;
grant execute on function public.admin_alert_source_allowed_v1_211(text,text,boolean) to service_role;

create or replace function public.admin_list_alert_followups_v1_211(p_actor_id uuid)
returns jsonb language plpgsql stable security definer
set search_path=pg_catalog
as $fn$
declare
 v_role text;
 v_followups jsonb;
 v_owners jsonb;
 v_events jsonb;
begin
 select admin_role into v_role from public.platform_admins
  where user_id=p_actor_id and active limit 1;
 if v_role is null or v_role not in
   ('superadmin','operations','support','finance','compliance','readonly') then
   raise exception 'ADMIN_PERMISSION_DENIED' using errcode='42501';
 end if;
 select coalesce(jsonb_agg(jsonb_build_object(
   'source',f.source,'ownerId',f.owner_id,'dueAt',f.due_at,
   'status',f.status,'note',f.note,'revision',f.revision,
   'updatedAt',f.updated_at,
   'overdue',(f.status<>'closed' and f.due_at<clock_timestamp()))
   order by f.due_at,f.source),'[]'::jsonb)
 into v_followups from public.admin_alert_followups_v1_211 f
 where public.admin_alert_source_allowed_v1_211(v_role,f.source,false);
 select coalesce(jsonb_agg(jsonb_build_object(
   'id',a.user_id,'role',a.admin_role)
   order by a.admin_role,a.user_id),'[]'::jsonb)
 into v_owners from public.platform_admins a where a.active and a.admin_role<>'readonly'
   and exists(select 1 from (values('incidents'),('support'),('finance'),('capture')) s(source)
     where public.admin_alert_source_allowed_v1_211(v_role,s.source,true)
       and public.admin_alert_source_allowed_v1_211(a.admin_role,s.source,true));
 select coalesce(jsonb_agg(jsonb_build_object(
   'source',x.source,'kind',x.event_kind,'revision',x.revision,
   'at',x.recorded_at,'actorId',x.actor_user_id)
    order by x.recorded_at desc,x.id desc),'[]'::jsonb)
 into v_events from (
   select e.* from public.admin_alert_followup_events_v1_211 e
   where public.admin_alert_source_allowed_v1_211(v_role,e.source,false)
   order by e.recorded_at desc,e.id desc limit 20
 ) x;
 return jsonb_build_object('source','database_authoritative','readOnly',true,
   'checkedAt',clock_timestamp(),'followups',v_followups,
   'owners',v_owners,'events',v_events);
end;$fn$;
revoke all on function public.admin_list_alert_followups_v1_211(uuid)
 from public,anon,authenticated;
grant execute on function public.admin_list_alert_followups_v1_211(uuid)
 to service_role;

create or replace function public.admin_set_alert_followup_v1_211(
 p_actor_id uuid,p_source text,p_owner_id uuid,p_due_at timestamptz,
 p_status text,p_note text,p_expected_revision integer
) returns jsonb language plpgsql volatile security definer
set search_path=pg_catalog
as $fn$
declare
 v_role text;v_owner_role text;
 v_prior public.admin_alert_followups_v1_211%rowtype;
 v_revision integer;
 v_event text;
 v_now timestamptz:=clock_timestamp();
begin
 select admin_role into v_role from public.platform_admins
  where user_id=p_actor_id and active limit 1;
 if v_role is null or not public.admin_alert_source_allowed_v1_211(v_role,p_source,true)
 then raise exception 'ADMIN_PERMISSION_DENIED' using errcode='42501';end if;
 select admin_role into v_owner_role from public.platform_admins
  where user_id=p_owner_id and active limit 1;
 if v_owner_role is null or not public.admin_alert_source_allowed_v1_211(v_owner_role,p_source,true)
 then raise exception 'INVALID_ALERT_OWNER' using errcode='22023';end if;
 if p_status not in ('open','monitoring','closed') or p_status is null or
   p_due_at is null or
   (p_status<>'closed' and p_due_at<v_now-interval '1 minute') or
   p_due_at>v_now+interval '90 days' or
   p_note is null or char_length(btrim(p_note)) not between 6 and 240 or
   p_expected_revision is null or p_expected_revision<0 then
   raise exception 'INVALID_ALERT_FOLLOWUP' using errcode='22023';
 end if;
 select * into v_prior from public.admin_alert_followups_v1_211
   where source=p_source for update;
 if not found then
   if p_expected_revision<>0 then
     raise exception 'ALERT_FOLLOWUP_CONFLICT' using errcode='40001';end if;
   insert into public.admin_alert_followups_v1_211
     (source,owner_id,due_at,status,note,updated_by,updated_at)
   values(p_source,p_owner_id,p_due_at,p_status,btrim(p_note),p_actor_id,v_now);
   v_revision:=1;v_event:='created';
 else
   if v_prior.revision<>p_expected_revision then
     raise exception 'ALERT_FOLLOWUP_CONFLICT' using errcode='40001';end if;
   if v_prior.owner_id=p_owner_id and v_prior.due_at=p_due_at
     and v_prior.status=p_status and v_prior.note=btrim(p_note) then
     return jsonb_build_object('source','server_authoritative',
       'changed',false,'revision',v_prior.revision);
   end if;
   v_revision:=v_prior.revision+1;
   v_event:=case
     when p_status='closed' and v_prior.status<>'closed' then 'closed'
     when v_prior.status='closed' and p_status<>'closed' then 'reopened'
     else 'updated' end;
   update public.admin_alert_followups_v1_211 set
     owner_id=p_owner_id,due_at=p_due_at,status=p_status,note=btrim(p_note),
     revision=v_revision,updated_by=p_actor_id,updated_at=v_now
    where source=p_source;
 end if;
 insert into public.admin_alert_followup_events_v1_211
   (source,event_kind,revision,actor_user_id,owner_id,due_at,status)
 values(p_source,v_event,v_revision,p_actor_id,p_owner_id,p_due_at,p_status);
 insert into public.platform_admin_audit
   (actor_user_id,action,target_type,target_id,metadata)
 values(p_actor_id,case when p_source='finance' then
     'operational_alert_followup_financial' else 'operational_alert_followup' end,
   'alert_group',p_source,
   jsonb_build_object('revision',v_revision,'event',v_event,
     'ownerId',p_owner_id,'dueAt',p_due_at,'status',p_status));
 return jsonb_build_object('source','server_authoritative',
   'changed',true,'revision',v_revision,'event',v_event);
end;$fn$;
revoke all on function public.admin_set_alert_followup_v1_211(uuid,text,uuid,timestamptz,text,text,integer)
 from public,anon,authenticated;
grant execute on function public.admin_set_alert_followup_v1_211(uuid,text,uuid,timestamptz,text,text,integer)
 to service_role;

-- A scheduled, once-per-revision overdue notice: does NOT send messages or change status.
create or replace function tamao_internal.record_alert_followup_overdue_v1_211()
returns integer language plpgsql volatile security invoker
set search_path=pg_catalog
as $fn$
declare v_count integer;
begin
 if session_user<>'postgres' then
   raise exception 'ALERT_OVERDUE_CRON_ONLY' using errcode='42501';end if;
 insert into public.admin_alert_followup_events_v1_211
   (source,event_kind,revision,actor_user_id,owner_id,due_at,status)
 select f.source,'overdue',f.revision,null,f.owner_id,f.due_at,f.status
 from public.admin_alert_followups_v1_211 f
 where f.status<>'closed' and f.due_at<clock_timestamp()
 on conflict (source,revision) where event_kind='overdue' do nothing;
 get diagnostics v_count=row_count;
 return v_count;
end;$fn$;
revoke all on function tamao_internal.record_alert_followup_overdue_v1_211()
 from public,anon,authenticated,service_role;
do $schedule$
begin
 if not exists(select 1 from cron.job
   where jobname='tamao-alert-followup-overdue-v1-211') then
   perform cron.schedule('tamao-alert-followup-overdue-v1-211','13 * * * *',
     'select tamao_internal.record_alert_followup_overdue_v1_211();');
 end if;
end;$schedule$;
