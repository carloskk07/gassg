-- TAMÃO V1.324 — founder-declared manual outreach follow-up. No message delivery is performed.
create table public.platform_ads_assistance_contacts_v1_324(
 request_id uuid primary key,
 merchant_id uuid not null references public.merchants(id),
 assistance_version integer not null check(assistance_version>0),
 reported_by uuid not null,
 channel text not null check(channel in ('whatsapp','phone','email')),
 outcome text not null check(outcome in ('not_reached','conversation','followup_requested','not_interested')),
 note text not null check(char_length(note) between 20 and 240),
 next_followup_on date,
 recorded_at timestamptz not null default clock_timestamp(),
 request_signature jsonb not null,
 check ((outcome='followup_requested' and next_followup_on is not null) or
        (outcome<>'followup_requested' and next_followup_on is null))
);
create index platform_ads_assistance_contacts_v1_324_merchant
 on public.platform_ads_assistance_contacts_v1_324(merchant_id,recorded_at desc);
alter table public.platform_ads_assistance_contacts_v1_324 enable row level security;
revoke all on public.platform_ads_assistance_contacts_v1_324 from public,anon,authenticated;
grant select,insert on public.platform_ads_assistance_contacts_v1_324 to service_role;

create or replace function public.admin_ads_contacts_read_v1_324(p_actor uuid)
returns jsonb language plpgsql stable security definer set search_path to 'pg_catalog' as $f$
declare v_total bigint;v_followups bigint;v_rows jsonb;
begin
 if p_actor is null or not exists(
   select 1 from public.platform_admins pa where pa.user_id=p_actor and pa.active
    and pa.admin_role in ('superadmin','operations','readonly')
 ) then raise exception 'ADS_CONTACTS_ADMIN_DENIED' using errcode='42501';end if;
 select count(*) into v_total from public.platform_ads_assistance_contacts_v1_324;
 select count(*) into v_followups
 from public.platform_ads_assistance_contacts_v1_324 c
 join public.platform_ads_assistance_v1_323 a on a.merchant_id=c.merchant_id
 join public.merchants m on m.id=a.merchant_id
 join public.merchant_ads_interest_v1_232 i on i.merchant_id=a.merchant_id
 where c.outcome='followup_requested'
 and c.next_followup_on<=(clock_timestamp() at time zone 'America/Sao_Paulo')::date
 and a.status in ('requested','triaged') and m.status='active' and i.interested
 and c.request_id=(select c2.request_id from public.platform_ads_assistance_contacts_v1_324 c2
   where c2.merchant_id=c.merchant_id order by c2.recorded_at desc,c2.request_id desc limit 1);
 select coalesce(jsonb_agg(jsonb_build_object(
   'merchantId',a.merchant_id,'assistanceVersion',a.version,'status',a.status,
   'consentCurrent',a.status in ('requested','triaged') and m.status='active' and coalesce(i.interested,false),
   'preferredChannel',a.channel,
   'attemptsCount',coalesce(x.attempts_count,0),
   'lastAttempt',case when c.request_id is null then null else jsonb_build_object(
      'outcome',c.outcome,'channel',c.channel,'note',c.note,
      'nextFollowupOn',c.next_followup_on,'reportedBy',c.reported_by,
      'recordedAt',c.recorded_at,'independentlyVerified',false) end
 ) order by a.requested_at desc,a.merchant_id),'[]'::jsonb) into v_rows
 from (select * from public.platform_ads_assistance_v1_323
       order by requested_at desc,merchant_id limit 50) a
 join public.merchants m on m.id=a.merchant_id
 left join public.merchant_ads_interest_v1_232 i on i.merchant_id=a.merchant_id
 left join lateral (select count(*) as attempts_count
   from public.platform_ads_assistance_contacts_v1_324 cc where cc.merchant_id=a.merchant_id) x on true
 left join lateral (
   select * from public.platform_ads_assistance_contacts_v1_324 cc
   where cc.merchant_id=a.merchant_id order by recorded_at desc,request_id desc limit 1
 ) c on true;
 return jsonb_build_object('source','admin_ads_contacts_v1_324','readOnly',true,
   'totalManualReports',v_total,'followupsDue',v_followups,'rows',v_rows,
   'automatedMessagesSent',0,'deliveryIndependentlyVerified',false,
   'noAutomaticOutreach',true,'adsLive',false,'paymentCreated',false);
end;
$f$;
revoke all on function public.admin_ads_contacts_read_v1_324(uuid) from public,anon,authenticated;
grant execute on function public.admin_ads_contacts_read_v1_324(uuid) to service_role;

create or replace function public.admin_ads_contact_record_v1_324(
 p_actor uuid,p_merchant uuid,p_expected_assistance_version integer,
 p_channel text,p_outcome text,p_note text,p_next_followup_on date,p_request uuid
) returns jsonb language plpgsql security definer set search_path to 'pg_catalog' as $f$
declare v_a public.platform_ads_assistance_v1_323%rowtype;
 v_m public.merchants%rowtype;v_interest boolean;v_sig jsonb;
 v_old public.platform_ads_assistance_contacts_v1_324%rowtype;
 v_today date;v_response jsonb;
begin
 if p_actor is null or not exists(select 1 from public.platform_admins pa
  where pa.user_id=p_actor and pa.active and pa.admin_role='superadmin')
 then raise exception 'ADS_CONTACT_FOUNDER_ONLY' using errcode='42501';end if;
 if p_request is null or p_merchant is null or p_expected_assistance_version is null
 or p_expected_assistance_version<1 or p_channel not in ('whatsapp','phone','email')
 or p_outcome not in ('not_reached','conversation','followup_requested','not_interested')
 or p_note is null or char_length(btrim(p_note)) not between 20 and 240
 then raise exception 'ADS_CONTACT_FIELDS_INVALID' using errcode='22023';end if;
 v_today:=(clock_timestamp() at time zone 'America/Sao_Paulo')::date;
 if (p_outcome='followup_requested' and
     (p_next_followup_on is null or p_next_followup_on<v_today+1 or p_next_followup_on>v_today+30))
 or (p_outcome<>'followup_requested' and p_next_followup_on is not null)
 then raise exception 'ADS_CONTACT_FOLLOWUP_INVALID' using errcode='22023';end if;
 v_sig:=jsonb_build_object('actor',p_actor,'merchant',p_merchant,
 'assistanceVersion',p_expected_assistance_version,'channel',p_channel,
 'outcome',p_outcome,'note',btrim(p_note),'nextFollowupOn',p_next_followup_on);
 select * into v_old from public.platform_ads_assistance_contacts_v1_324 where request_id=p_request;
 if found then
  if v_old.request_signature is distinct from v_sig
   then raise exception 'ADS_CONTACT_REQUEST_REUSE' using errcode='23505';end if;
  return jsonb_build_object('source','admin_ads_contact_record_v1_324',
    'merchantId',p_merchant,'recorded',true,'replayed',true,
    'outcome',v_old.outcome,'assistanceVersion',v_old.assistance_version,
    'automatedMessageSent',false,'independentlyVerified',false,
    'adsLive',false,'paymentCreated',false);
 end if;
 select * into v_a from public.platform_ads_assistance_v1_323
  where merchant_id=p_merchant for update;
 select * into v_m from public.merchants where id=p_merchant for update;
 select i.interested into v_interest from public.merchant_ads_interest_v1_232 i
 where i.merchant_id=p_merchant for update;
 if v_a.merchant_id is null or v_a.version<>p_expected_assistance_version
 or v_a.status not in ('requested','triaged') or v_m.status<>'active'
 or v_interest is distinct from true or p_channel<>v_a.channel
 then raise exception 'ADS_CONTACT_CONSENT_NOT_CURRENT' using errcode='40001';end if;
 insert into public.platform_ads_assistance_contacts_v1_324(
  request_id,merchant_id,assistance_version,reported_by,channel,outcome,note,
  next_followup_on,request_signature)
 values(p_request,p_merchant,p_expected_assistance_version,p_actor,p_channel,
  p_outcome,btrim(p_note),p_next_followup_on,v_sig);
 insert into public.platform_admin_audit(actor_user_id,action,target_type,target_id,metadata)
 values(p_actor,'ads-assistance-manual-contact-report','merchant',p_merchant::text,
  jsonb_build_object('requestId',p_request,'outcome',p_outcome,
   'assistanceVersion',v_a.version,'manualDeclaration',true,
   'deliveryIndependentlyVerified',false,'nextFollowupOn',p_next_followup_on));
 return jsonb_build_object('source','admin_ads_contact_record_v1_324',
   'merchantId',p_merchant,'recorded',true,'replayed',false,
   'outcome',p_outcome,'assistanceVersion',v_a.version,
   'automatedMessageSent',false,'independentlyVerified',false,
   'adsLive',false,'paymentCreated',false);
end;
$f$;
revoke all on function public.admin_ads_contact_record_v1_324(uuid,uuid,integer,text,text,text,date,uuid)
 from public,anon,authenticated;
grant execute on function public.admin_ads_contact_record_v1_324(uuid,uuid,integer,text,text,text,date,uuid)
 to service_role;
