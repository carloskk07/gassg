-- TAMÃO V1.214: acknowledgment of assignment by the actual active owner.
-- Acknowledgment applies ONLY to the current revision and never resolves the underlying alert.
alter table public.admin_alert_followup_events_v1_211
 drop constraint admin_alert_followup_events_v1_211_event_kind_check;
alter table public.admin_alert_followup_events_v1_211
 add constraint admin_alert_followup_events_v1_211_event_kind_check
 check(event_kind in ('created','updated','closed','reopened','overdue','acknowledged'));

create unique index if not exists admin_alert_ack_once_per_revision_v1_214
 on public.admin_alert_followup_events_v1_211(source,revision)
 where event_kind='acknowledged';

create or replace function public.admin_ack_alert_followup_v1_214(
  p_actor_id uuid,p_source text,p_expected_revision integer
) returns jsonb language plpgsql volatile security definer
set search_path=pg_catalog
as $fn$
declare
  v_followup public.admin_alert_followups_v1_211%rowtype;
  v_actor_role text;
  v_saved_id bigint;
  v_when timestamptz;
begin
  select admin_role into v_actor_role from public.platform_admins
   where user_id=p_actor_id and active limit 1;
  if v_actor_role is null or
    not public.admin_alert_source_allowed_v1_211(v_actor_role,p_source,true) then
    raise exception 'ADMIN_PERMISSION_DENIED' using errcode='42501';
  end if;
  if p_expected_revision is null or p_expected_revision<1 then
    raise exception 'INVALID_ALERT_ACK_REVISION' using errcode='22023';
  end if;
  select * into v_followup from public.admin_alert_followups_v1_211
   where source=p_source for update;
  if not found then
    raise exception 'ALERT_FOLLOWUP_NOT_FOUND' using errcode='P0002';
  end if;
  if v_followup.owner_id<>p_actor_id then
    raise exception 'ALERT_ACK_OWNER_ONLY' using errcode='42501';
  end if;
  if v_followup.revision<>p_expected_revision then
    raise exception 'ALERT_FOLLOWUP_CONFLICT' using errcode='40001';
  end if;
  if v_followup.status='closed' then
    raise exception 'ALERT_FOLLOWUP_ALREADY_CLOSED' using errcode='22023';
  end if;
  insert into public.admin_alert_followup_events_v1_211
    (source,event_kind,revision,actor_user_id,owner_id,due_at,status)
  values(p_source,'acknowledged',v_followup.revision,p_actor_id,
    v_followup.owner_id,v_followup.due_at,v_followup.status)
  on conflict (source,revision) where event_kind='acknowledged' do nothing
  returning id,recorded_at into v_saved_id,v_when;
  if v_saved_id is null then
    select e.recorded_at into v_when
     from public.admin_alert_followup_events_v1_211 e
     where e.source=p_source and e.revision=v_followup.revision
       and e.event_kind='acknowledged' and e.actor_user_id=p_actor_id
     order by e.recorded_at desc limit 1;
    if v_when is null then
      raise exception 'ALERT_ACK_NOT_VERIFIED' using errcode='P0002';
    end if;
    return jsonb_build_object('source','server_authoritative',
      'changed',false,'revision',v_followup.revision,'acknowledgedAt',v_when);
  end if;
  insert into public.platform_admin_audit
    (actor_user_id,action,target_type,target_id,metadata)
  values(p_actor_id,
    case when p_source='finance' then 'operational_alert_ack_financial'
         else 'operational_alert_acknowledged' end,
    'alert_group',p_source,
    jsonb_build_object('revision',v_followup.revision,'ownerId',p_actor_id));
  return jsonb_build_object('source','server_authoritative',
    'changed',true,'revision',v_followup.revision,'acknowledgedAt',v_when);
end;
$fn$;
revoke all on function public.admin_ack_alert_followup_v1_214(uuid,text,integer)
 from public,anon,authenticated;
grant execute on function public.admin_ack_alert_followup_v1_214(uuid,text,integer)
 to service_role;

-- The existing list RPC keeps all other V1.212 permission and SLA semantics unchanged.

create or replace function public.admin_list_alert_followups_v1_211(p_actor_id uuid)
returns jsonb language plpgsql stable security definer
set search_path=pg_catalog
as $fn$
declare
 v_role text;
 v_followups jsonb;
 v_owners jsonb;
 v_events jsonb;
 v_now timestamptz:=clock_timestamp();
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
   'acknowledgedAt',ack.ack_at,
   'ackStatus',case when f.status='closed' then 'not_applicable'
     when ack.ack_at is not null then 'acknowledged'
     when f.updated_at<=v_now-interval '2 hours' then 'overdue'
     else 'pending' end,
   'updatedAt',f.updated_at,
   'overdue',(f.status<>'closed' and f.due_at<v_now),
   'ownerEligible',(owner.active is true and
      coalesce(public.admin_alert_source_allowed_v1_211(owner.admin_role,f.source,true),false)),
   'urgency',case
     when f.status='closed' then 'closed'
     when owner.active is not true or not coalesce(
       public.admin_alert_source_allowed_v1_211(owner.admin_role,f.source,true),false)
       then 'owner_unavailable'
     when f.due_at<=v_now-interval '24 hours' then 'severely_overdue'
     when f.due_at<v_now then 'overdue'
     when f.due_at<=v_now+interval '2 hours' then 'due_soon'
     else 'on_track' end)
   order by f.due_at,f.source),'[]'::jsonb)
 into v_followups from public.admin_alert_followups_v1_211 f
 left join public.platform_admins owner on owner.user_id=f.owner_id
 left join lateral (
  select max(e.recorded_at) as ack_at
  from public.admin_alert_followup_events_v1_211 e
  where e.source=f.source and e.revision=f.revision
    and e.event_kind='acknowledged' and e.actor_user_id=f.owner_id
 ) ack on true
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
   'checkedAt',v_now,'followups',v_followups,
   'owners',v_owners,'events',v_events);
end;$fn$;
revoke all on function public.admin_list_alert_followups_v1_211(uuid)
 from public,anon,authenticated;
grant execute on function public.admin_list_alert_followups_v1_211(uuid)
 to service_role;
