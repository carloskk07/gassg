-- TAMÃO V1.327 — link a due/future manual return plan to a new founder-declared attempt.
-- Never claim actual delivery or independently verified communication.
alter table public.platform_ads_feedback_returns_v1_326
 drop constraint platform_ads_feedback_returns_v1_326_status_check;
alter table public.platform_ads_feedback_returns_v1_326
 add constraint platform_ads_feedback_returns_v1_326_status_check
 check(status in ('scheduled','canceled','attempt_recorded'));
alter table public.platform_ads_feedback_returns_v1_326
 add column attempt_contact_request_id uuid unique references public.platform_ads_assistance_contacts_v1_324(request_id),
 add column attempt_recorded_at timestamptz;
alter table public.platform_ads_feedback_returns_v1_326
 add constraint platform_ads_feedback_return_attempt_consistency_v1_327 check(
 (status='attempt_recorded' and attempt_contact_request_id is not null and attempt_recorded_at is not null)
 or (status in ('scheduled','canceled') and attempt_contact_request_id is null and attempt_recorded_at is null)
);

create or replace function public.ads_return_link_actual_report_v1_327()
returns trigger language plpgsql set search_path to 'pg_catalog' as $f$
declare v_plan_id uuid;
begin
 -- An attempt is only a founder declaration, never proof that the merchant received it.
 -- The originating v1.324 RPC locks the assistance row, which serializes request cycles.
 update public.platform_ads_feedback_returns_v1_326 r
 set status='attempt_recorded',version=r.version+1,
  attempt_contact_request_id=new.request_id,attempt_recorded_at=new.recorded_at,
  updated_by=new.reported_by,updated_at=clock_timestamp()
 from public.platform_ads_assistance_contacts_v1_324 prior
 join public.platform_ads_assistance_v1_323 a on a.merchant_id=new.merchant_id
 where r.contact_request_id=prior.request_id
   and r.merchant_id=new.merchant_id and r.status='scheduled'
   and r.assistance_version=new.assistance_version
   and a.version=new.assistance_version and a.status in ('requested','triaged')
   and new.channel=a.channel and new.recorded_at>=a.requested_at
   and prior.merchant_id=new.merchant_id and prior.recorded_at>=a.requested_at
   and prior.recorded_at<new.recorded_at
   and exists(select 1 from public.merchants m
     where m.id=new.merchant_id and m.status='active')
   and exists(select 1 from public.merchant_ads_interest_v1_232 i
     where i.merchant_id=new.merchant_id and i.interested)
 returning r.contact_request_id into v_plan_id;
 if v_plan_id is not null then
  insert into public.platform_admin_audit(actor_user_id,action,target_type,target_id,metadata)
  values(new.reported_by,'ads-return-attempt-reported','merchant',new.merchant_id::text,
    jsonb_build_object('contactRequestId',new.request_id,'originalPlanContactId',v_plan_id,
       'outcome',new.outcome,'independentlyVerified',false,'messageSent',false));
 end if;
 return new;
end;
$f$;
create trigger ads_return_link_attempt_after_contact_v1_327
 after insert on public.platform_ads_assistance_contacts_v1_324
 for each row execute function public.ads_return_link_actual_report_v1_327();

create or replace function public.admin_ads_return_execution_read_v1_327(p_actor uuid)
returns jsonb language plpgsql stable security definer set search_path to 'pg_catalog' as $f$
declare v_rows jsonb;v_all bigint;v_planned bigint;v_attempts bigint;v_due bigint;
begin
 if p_actor is null or not exists(select 1 from public.platform_admins pa where pa.user_id=p_actor
  and pa.active and pa.admin_role in ('superadmin','operations','readonly'))
 then raise exception 'ADS_RETURN_EXECUTION_READ_DENIED' using errcode='42501';end if;
 select count(*),count(*) filter(where status='scheduled'),
  count(*) filter(where status='attempt_recorded')
 into v_all,v_planned,v_attempts from public.platform_ads_feedback_returns_v1_326;
 select count(*) into v_due from public.platform_ads_feedback_returns_v1_326 r
 join public.platform_ads_assistance_v1_323 a on a.merchant_id=r.merchant_id
 join public.merchants m on m.id=r.merchant_id
 join public.merchant_ads_interest_v1_232 i on i.merchant_id=r.merchant_id
 where r.status='scheduled' and r.due_on<=(clock_timestamp() at time zone 'America/Sao_Paulo')::date
 and a.status in ('requested','triaged') and a.version=r.assistance_version
 and m.status='active' and i.interested
 and r.contact_request_id=(select c.request_id from public.platform_ads_assistance_contacts_v1_324 c
  where c.merchant_id=r.merchant_id and c.recorded_at>=a.requested_at
  order by c.recorded_at desc,c.request_id desc limit 1);
 select coalesce(jsonb_agg(jsonb_build_object(
  'merchantId',r.merchant_id,'merchantName',left(m.name,120),
  'contactRequestId',r.contact_request_id,
  'assistanceVersion',r.assistance_version,
  'consentCurrent',coalesce(a.status in ('requested','triaged') and a.version=r.assistance_version
    and m.status='active' and i.interested,false),
  'status',r.status,'version',r.version,'dueOn',r.due_on,
  'internalNote',r.internal_note,'updatedAt',r.updated_at,
  'attemptReportedAt',r.attempt_recorded_at,
  'attemptRequestId',r.attempt_contact_request_id,
  'attemptOutcome',c.outcome,'attemptChannel',c.channel,
  'attemptIndependentlyVerified',false
 ) order by (r.status='scheduled') desc,r.due_on asc,r.updated_at desc),'[]'::jsonb)
 into v_rows
 from (select * from public.platform_ads_feedback_returns_v1_326
   order by (status='scheduled') desc,due_on asc,updated_at desc limit 50) r
 join public.merchants m on m.id=r.merchant_id
 left join public.platform_ads_assistance_v1_323 a on a.merchant_id=r.merchant_id
 left join public.merchant_ads_interest_v1_232 i on i.merchant_id=r.merchant_id
 left join public.platform_ads_assistance_contacts_v1_324 c
   on c.request_id=r.attempt_contact_request_id;
 return jsonb_build_object('source','admin_ads_return_execution_v1_327','readOnly',true,
  'totalPlans',v_all,'scheduledPlans',v_planned,'attemptsDeclared',v_attempts,
  'followupsDue',v_due,'rows',v_rows,'automaticMessagesSent',0,
  'independentDeliveryProof',false,'adsLive',false,'paymentCreated',false);
end;
$f$;
revoke all on function public.admin_ads_return_execution_read_v1_327(uuid) from public,anon,authenticated;
grant execute on function public.admin_ads_return_execution_read_v1_327(uuid) to service_role;

create or replace function public.merchant_ads_return_execution_v1_327(p_actor uuid,p_merchant uuid)
returns jsonb language plpgsql stable security definer set search_path to 'pg_catalog' as $f$
declare v_role text;v_a public.platform_ads_assistance_v1_323%rowtype;
 v_r public.platform_ads_feedback_returns_v1_326%rowtype;v_c public.platform_ads_assistance_contacts_v1_324%rowtype;
 v_current boolean;
begin
 select mm.member_role into v_role from public.merchant_members mm
 where mm.user_id=p_actor and mm.merchant_id=p_merchant and mm.active
  and mm.member_role in ('owner','manager') limit 1;
 if v_role is null then raise exception 'ADS_RETURN_EXECUTION_MERCHANT_DENIED' using errcode='42501';end if;
 select * into v_a from public.platform_ads_assistance_v1_323 where merchant_id=p_merchant;
 v_current:=v_a.merchant_id is not null and v_a.status in ('requested','triaged')
  and exists(select 1 from public.merchants m where m.id=p_merchant and m.status='active')
  and exists(select 1 from public.merchant_ads_interest_v1_232 i
   where i.merchant_id=p_merchant and i.interested);
 if v_current then
  select r.* into v_r from public.platform_ads_feedback_returns_v1_326 r
  join public.platform_ads_assistance_contacts_v1_324 origin
   on origin.request_id=r.contact_request_id
  where r.merchant_id=p_merchant and r.assistance_version=v_a.version
   and origin.recorded_at>=v_a.requested_at
  order by r.updated_at desc,r.contact_request_id desc limit 1;
  if v_r.attempt_contact_request_id is not null then
   select * into v_c from public.platform_ads_assistance_contacts_v1_324
   where request_id=v_r.attempt_contact_request_id and merchant_id=p_merchant;
  end if;
 end if;
 return jsonb_build_object('source','merchant_ads_return_execution_v1_327',
  'merchantId',p_merchant,'readOnly',true,'consentCurrent',v_current,
  'plan',case when v_current and v_r.contact_request_id is not null then
   jsonb_build_object('status',v_r.status,'version',v_r.version,'dueOn',v_r.due_on,
    'attemptReportedAt',v_r.attempt_recorded_at,'attemptOutcome',v_c.outcome,
    'attemptIndependentlyVerified',false)
  else null end,
  'automaticMessagesSent',0,'independentDeliveryProof',false,
  'adsLive',false,'paymentCreated',false);
end;
$f$;
revoke all on function public.merchant_ads_return_execution_v1_327(uuid,uuid) from public,anon,authenticated;
grant execute on function public.merchant_ads_return_execution_v1_327(uuid,uuid) to service_role;
