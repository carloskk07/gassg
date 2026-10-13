-- TAMÃO V1.212 — trustworthy server-calculated operational SLA escalation.
-- No new permissions; this replaces only the existing service-role-only read RPC.
-- Roles and source visibility remain unchanged; owner status is revalidated on every read.
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

