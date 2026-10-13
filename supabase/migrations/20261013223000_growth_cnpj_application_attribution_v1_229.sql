-- TAMÃO V1.229 — merchant-application referral attribution, before any payout.
-- Immutable first touch, bound to a freshly created authenticated application
-- and its validated CNPJ. A same-phone lead is ONLY an unverified candidate.
create table if not exists public.growth_merchant_application_attributions_v1_229(
  application_id uuid primary key references public.merchant_applications(id) on delete cascade,
  cnpj text not null unique check(cnpj ~ '^[0-9A-Z]{12}[0-9]{2}$'),
  referral_code text not null check(referral_code ~ '^[A-Z0-9]{5,40}$'),
  inviter_kind text not null check(inviter_kind in ('customer','merchant')),
  inviter_user_id uuid references auth.users(id) on delete set null,
  inviter_merchant_id uuid references public.merchants(id) on delete set null,
  lead_candidate_id uuid references public.prelaunch_leads(id) on delete set null,
  lead_evidence text not null default 'none' check(lead_evidence in ('none','contact_match_unverified')),
  status text not null default 'unverified' check(status='unverified'),
  reward_eligible boolean not null default false check(reward_eligible=false),
  created_at timestamptz not null default clock_timestamp(),
  check((inviter_kind='customer' and inviter_merchant_id is null)
    or (inviter_kind='merchant' and inviter_user_id is null)),
  check((lead_candidate_id is null and lead_evidence='none')
    or (lead_candidate_id is not null and lead_evidence='contact_match_unverified'))
);
create index if not exists growth_application_attr_inviter_merchant_v1_229
  on public.growth_merchant_application_attributions_v1_229(inviter_merchant_id)
  where inviter_merchant_id is not null;
create index if not exists growth_application_attr_inviter_user_v1_229
  on public.growth_merchant_application_attributions_v1_229(inviter_user_id)
  where inviter_user_id is not null;
create index if not exists growth_application_attr_lead_candidate_v1_229
  on public.growth_merchant_application_attributions_v1_229(lead_candidate_id)
  where lead_candidate_id is not null;
alter table public.growth_merchant_application_attributions_v1_229 enable row level security;
revoke all on public.growth_merchant_application_attributions_v1_229
  from public,anon,authenticated;
grant select,insert on public.growth_merchant_application_attributions_v1_229
  to service_role;

create or replace function public.claim_growth_application_referral_v1_229(
  p_application_id uuid,p_actor_user_id uuid,p_code text
) returns jsonb language plpgsql volatile security invoker
set search_path=pg_catalog as $fn$
declare
 v_app public.merchant_applications%rowtype;
 v_code text:=upper(btrim(coalesce(p_code,'')));
 v_inviter_merchant uuid;
 v_inviter_user uuid;
 v_kind text;
 v_lead uuid;
 v_new uuid;
begin
 if v_code !~ '^[A-Z0-9]{5,40}$' then
   return jsonb_build_object('recorded',false,'reason','INVALID_CODE');
 end if;
 select * into v_app from public.merchant_applications
  where id=p_application_id and applicant_user_id=p_actor_user_id
    and status='pending';
 if v_app.id is null then
   return jsonb_build_object('recorded',false,'reason','APPLICATION_NOT_FOUND');
 end if;
 if v_app.created_at<clock_timestamp()-interval '10 minutes'
    or v_app.created_at>clock_timestamp()+interval '1 minute' then
   return jsonb_build_object('recorded',false,'reason','NOT_NEW_APPLICATION');
 end if;
 -- Old claims are never rewritten or rebound to another CNPJ/inviter.
 if exists(select 1 from public.growth_merchant_application_attributions_v1_229
   where application_id=v_app.id or cnpj=v_app.cnpj) then
   return jsonb_build_object('recorded',false,'reason','ALREADY_ATTRIBUTED');
 end if;
 if v_code ~ '^TMR[A-F0-9]{24}$' then
   select i.merchant_id into v_inviter_merchant
     from public.growth_merchant_invites_v1_226 i
     join public.merchants m on m.id=i.merchant_id
     where i.invite_code=v_code and m.cnpj<>v_app.cnpj
       and m.status in ('active','pending');
   if v_inviter_merchant is null then
     return jsonb_build_object('recorded',false,'reason','INVALID_INVITER');
   end if;
   if exists(select 1 from public.merchant_members m
     where m.merchant_id=v_inviter_merchant
       and m.user_id=p_actor_user_id) then
     return jsonb_build_object('recorded',false,'reason','SELF_INVITE_BLOCKED');
   end if;
   v_kind:='merchant';
 else
   select p.user_id into v_inviter_user from public.profiles p
     where upper(p.referral_code)=v_code and p.user_id<>p_actor_user_id;
   if v_inviter_user is null then
     return jsonb_build_object('recorded',false,'reason','INVALID_INVITER');
   end if;
   v_kind:='customer';
 end if;
 -- The same phone and code can signal a prior *lead candidate*, but
 -- neither that match nor the applicant's claim verifies corporate identity.
 select l.id into v_lead from public.growth_lead_attributions_v1_226 a
   join public.prelaunch_leads l on l.id=a.lead_id
   where a.referral_code=v_code and l.lead_type='merchant'
     and l.phone=v_app.phone and l.consent_at is not null
     and a.attributed_at>=v_app.created_at-interval '90 days'
     and a.attributed_at<=v_app.created_at+interval '1 minute'
   order by a.attributed_at asc,l.id asc limit 1;
 insert into public.growth_merchant_application_attributions_v1_229(
   application_id,cnpj,referral_code,inviter_kind,inviter_user_id,
   inviter_merchant_id,lead_candidate_id,lead_evidence
 ) values(v_app.id,v_app.cnpj,v_code,v_kind,v_inviter_user,
   v_inviter_merchant,v_lead,
   case when v_lead is null then 'none' else 'contact_match_unverified' end)
 on conflict do nothing returning application_id into v_new;
 return jsonb_build_object('recorded',v_new is not null,
   'reason',case when v_new is null then 'ALREADY_ATTRIBUTED' else 'CNPJ_REFERRAL_CAPTURED_UNVERIFIED' end,
   'verified',false,'rewardEligible',false);
end;
$fn$;
revoke all on function public.claim_growth_application_referral_v1_229(uuid,uuid,text)
 from public,anon,authenticated;
grant execute on function public.claim_growth_application_referral_v1_229(uuid,uuid,text)
 to service_role;

create or replace function public.admin_growth_application_funnel_v1_229(
 p_actor_user_id uuid
) returns jsonb language plpgsql stable security invoker
set search_path=pg_catalog as $fn$
declare
 v_total bigint;v_candidates bigint;v_approved bigint;v_cnpj_linked bigint;
 v_active bigint;v_by_merchants bigint;v_by_customers bigint;
 v_rows jsonb:='[]'::jsonb;
begin
 if not exists(select 1 from public.platform_admins a
  where a.user_id=p_actor_user_id and a.active
    and a.admin_role in ('superadmin','operations','readonly','compliance')) then
   raise exception 'ADMIN_GROWTH_APPLICATION_PERMISSION_DENIED' using errcode='42501';
 end if;
 select count(*)::bigint,
   count(*) filter(where a.lead_candidate_id is not null)::bigint,
   count(*) filter(where app.status='approved')::bigint,
   count(*) filter(where m.id is not null and app.status='approved'
      and owner.member_role='owner' and owner.active)::bigint,
   count(*) filter(where m.status='active' and app.status='approved'
      and owner.member_role='owner' and owner.active)::bigint,
   count(*) filter(where a.inviter_kind='merchant')::bigint,
   count(*) filter(where a.inviter_kind='customer')::bigint
 into v_total,v_candidates,v_approved,v_cnpj_linked,v_active,
   v_by_merchants,v_by_customers
 from public.growth_merchant_application_attributions_v1_229 a
 join public.merchant_applications app on app.id=a.application_id
 left join public.merchants m on m.cnpj=a.cnpj
 left join public.merchant_members owner on owner.merchant_id=m.id
   and owner.user_id=app.applicant_user_id and owner.member_role='owner' and owner.active;
 select coalesce(jsonb_agg(jsonb_build_object(
   'applicationId',r.application_id,
   'companyName',r.company_name,
   'cnpjSuffix',right(r.cnpj,4),
   'inviterKind',r.inviter_kind,
   'applicationStatus',r.application_status,
   'merchantLinked',r.merchant_linked,
   'activeMerchant',r.active_merchant,
   'leadCandidate',r.lead_candidate,
   'verified',false,'rewardEligible',false,
   'recordedAt',r.created_at
  ) order by r.created_at desc,r.application_id desc),'[]'::jsonb)
 into v_rows from (
   select a.application_id,app.company_name,a.cnpj,a.inviter_kind,
      app.status application_status,
      (m.id is not null and owner.user_id is not null and
        app.status='approved') merchant_linked,
      (m.status='active' and owner.user_id is not null and
        app.status='approved') active_merchant,
      a.lead_candidate_id is not null lead_candidate,a.created_at
   from public.growth_merchant_application_attributions_v1_229 a
   join public.merchant_applications app on app.id=a.application_id
   left join public.merchants m on m.cnpj=a.cnpj
   left join public.merchant_members owner on owner.merchant_id=m.id
      and owner.user_id=app.applicant_user_id
      and owner.member_role='owner' and owner.active
   order by a.created_at desc,a.application_id desc limit 12
 ) r;
 return jsonb_build_object(
   'source','growth_cnpj_application_funnel_v1_229',
   'readOnly',true,'noPayout',true,'noPersonalContactData',true,
   'attributionNeverFinancialProof',true,
   'firstLevelOnly',true,
   'applicationsAttributed',v_total,
   'contactCandidatesUnverified',v_candidates,
   'applicationsApproved',v_approved,
   'approvedCnpjOwnerMatches',v_cnpj_linked,
   'activeMatchedMerchants',v_active,
   'invitedByMerchants',v_by_merchants,
   'invitedByCustomers',v_by_customers,
   'rows',v_rows);
end;
$fn$;
revoke all on function public.admin_growth_application_funnel_v1_229(uuid)
 from public,anon,authenticated;
grant execute on function public.admin_growth_application_funnel_v1_229(uuid)
 to service_role;
