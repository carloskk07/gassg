-- TAMÃO V1.328: factual close-out of a founder-declared Ads follow-up.
-- Never infer delivery from admin notes; only voluntary feedback from the merchant owner.
create or replace function public.admin_ads_return_feedback_closeout_v1_328(p_actor uuid)
returns jsonb language plpgsql stable security definer set search_path to 'pg_catalog' as $f$
declare v_rows jsonb;v_total bigint;v_waiting bigint;v_confirmed bigint;v_disputed bigint;
begin
 if p_actor is null or not exists(
  select 1 from public.platform_admins a
  where a.user_id=p_actor and a.active
   and a.admin_role in ('superadmin','operations','readonly')
 ) then raise exception 'ADS_RETURN_CLOSEOUT_ACCESS_DENIED' using errcode='42501';end if;

 select count(*) into v_total from public.platform_ads_feedback_returns_v1_326
 where status='attempt_recorded';
 with eligible as (
  select r.contact_request_id,r.attempt_contact_request_id,r.merchant_id,
   r.attempt_recorded_at,
   f.response,
   (a.status in ('requested','triaged') and a.version=r.assistance_version
    and m.status='active' and i.interested and
    c.request_id=r.attempt_contact_request_id
    and c.recorded_at>=a.requested_at and c.channel=a.channel
    and c.request_id=(select latest.request_id
      from public.platform_ads_assistance_contacts_v1_324 latest
      where latest.merchant_id=r.merchant_id and latest.recorded_at>=a.requested_at
      order by latest.recorded_at desc,latest.request_id desc limit 1)
   ) as current_cycle
  from public.platform_ads_feedback_returns_v1_326 r
  join public.platform_ads_assistance_v1_323 a on a.merchant_id=r.merchant_id
  join public.merchants m on m.id=r.merchant_id
  join public.merchant_ads_interest_v1_232 i on i.merchant_id=r.merchant_id
  join public.platform_ads_assistance_contacts_v1_324 c
    on c.request_id=r.attempt_contact_request_id and c.merchant_id=r.merchant_id
  left join public.platform_ads_contact_feedback_v1_325 f
    on f.contact_request_id=r.attempt_contact_request_id
  where r.status='attempt_recorded'
 )
 select count(*) filter(where current_cycle and response is null),
  count(*) filter(where current_cycle and response='contact_confirmed'),
  count(*) filter(where current_cycle and response in ('contact_not_received','followup_needed'))
 into v_waiting,v_confirmed,v_disputed from eligible;

 select coalesce(jsonb_agg(jsonb_build_object(
   'merchantId',q.merchant_id,'merchantName',left(q.merchant_name,120),
   'originalContactId',q.contact_request_id,
   'attemptContactId',q.attempt_contact_request_id,
   'attemptReportedAt',q.attempt_recorded_at,
   'attemptOutcome',q.attempt_outcome,
   'currentConsentAndLatestAttempt',q.current_cycle,
   'feedbackResponse',q.response,
   'feedbackAt',q.submitted_at,
   'state',case when not q.current_cycle then 'outdated'
     when q.response='contact_confirmed' then 'merchant_confirmed'
     when q.response='contact_not_received' then 'merchant_disputed'
     when q.response='followup_needed' then 'merchant_requested_followup'
     else 'awaiting_merchant_feedback' end,
   'attentionRequired',q.current_cycle and
     (q.response in ('contact_not_received','followup_needed')
       or (q.response is null and q.attempt_recorded_at<clock_timestamp()-interval '48 hours')),
   'independentlyVerified',false
 ) order by q.current_cycle desc,
  case when q.current_cycle and q.response in ('contact_not_received','followup_needed') then 0
       when q.current_cycle and q.response is null then 1
       when q.current_cycle and q.response='contact_confirmed' then 2 else 3 end,
  q.attempt_recorded_at asc,q.merchant_id),'[]'::jsonb)
 into v_rows
 from (
   select r.merchant_id,m.name merchant_name,r.contact_request_id,
    r.attempt_contact_request_id,r.attempt_recorded_at,
    c.outcome attempt_outcome,f.response,f.submitted_at,
    (a.status in ('requested','triaged') and a.version=r.assistance_version
       and m.status='active' and coalesce(i.interested,false)
       and c.request_id=(select latest.request_id
         from public.platform_ads_assistance_contacts_v1_324 latest
         where latest.merchant_id=r.merchant_id and latest.recorded_at>=a.requested_at
         order by latest.recorded_at desc,latest.request_id desc limit 1)
       and c.recorded_at>=a.requested_at and c.channel=a.channel
    ) current_cycle
   from public.platform_ads_feedback_returns_v1_326 r
   join public.platform_ads_assistance_v1_323 a on a.merchant_id=r.merchant_id
   join public.merchants m on m.id=r.merchant_id
   left join public.merchant_ads_interest_v1_232 i on i.merchant_id=r.merchant_id
   join public.platform_ads_assistance_contacts_v1_324 c
     on c.request_id=r.attempt_contact_request_id and c.merchant_id=r.merchant_id
   left join public.platform_ads_contact_feedback_v1_325 f
     on f.contact_request_id=r.attempt_contact_request_id
   where r.status='attempt_recorded'
   order by r.attempt_recorded_at desc,r.merchant_id limit 50
 ) q;
 return jsonb_build_object('source','admin_ads_return_feedback_closeout_v1_328',
  'readOnly',true,'totalAttemptsDeclared',v_total,
  'awaitingMerchantFeedback',v_waiting,'confirmedByMerchant',v_confirmed,
  'disputedOrFollowupRequested',v_disputed,'rows',v_rows,
  'messagesSent',0,'independentDeliveryProof',false,
  'adsLive',false,'paymentCreated',false);
end;
$f$;
revoke all on function public.admin_ads_return_feedback_closeout_v1_328(uuid) from public,anon,authenticated;
grant execute on function public.admin_ads_return_feedback_closeout_v1_328(uuid) to service_role;
