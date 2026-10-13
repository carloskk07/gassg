-- TAMÃO V1.230 — append-only administrative referral evidence and review.
-- Never modifies first-touch attribution and never grants a financial benefit.
create table if not exists public.growth_referral_reviews_v1_230 (
 id uuid primary key default gen_random_uuid(),
 application_id uuid not null references public.growth_merchant_application_attributions_v1_229(application_id) on delete restrict,
 reviewer_user_id uuid not null references auth.users(id) on delete restrict,
 decision text not null check(decision in ('verified_identity','rejected','needs_evidence')),
 evidence_cnpj_match boolean not null default false,
 evidence_owner_match boolean not null default false,
 evidence_inviter_valid boolean not null default false,
 reason text not null check(char_length(btrim(reason)) between 12 and 800),
 evidence_reference text check(evidence_reference is null or char_length(evidence_reference) between 8 and 160),
 reward_eligible boolean not null default false check(reward_eligible=false),
 created_at timestamptz not null default clock_timestamp(),
 check(decision <> 'verified_identity' or
    (evidence_cnpj_match and evidence_owner_match and evidence_inviter_valid
     and evidence_reference is not null))
);
create index if not exists growth_referral_reviews_app_created_v1_230
 on public.growth_referral_reviews_v1_230(application_id,created_at desc,id desc);
alter table public.growth_referral_reviews_v1_230 enable row level security;
revoke all on table public.growth_referral_reviews_v1_230 from public,anon,authenticated,service_role;
grant select on table public.growth_referral_reviews_v1_230 to service_role;
-- Only this RPC can append a decision. Caller must be an authenticated
-- administrative Edge Function that supplies the actual verified auth subject.
create or replace function public.admin_review_growth_referral_v1_230(
 p_actor_user_id uuid,p_application_id uuid,p_decision text,p_reason text,
 p_cnpj_match boolean,p_owner_match boolean,p_inviter_valid boolean,
 p_evidence_reference text
) returns jsonb language plpgsql volatile security definer
set search_path=pg_catalog as $fn$
declare
 v_attr public.growth_merchant_application_attributions_v1_229%rowtype;
 v_app public.merchant_applications%rowtype;
 v_merchant public.merchants%rowtype;
 v_record uuid;
 v_reference text:=nullif(btrim(coalesce(p_evidence_reference,'')),'');
begin
 if not exists(select 1 from public.platform_admins where user_id=p_actor_user_id
    and active and admin_role in ('superadmin','compliance')) then
   raise exception 'REFERRAL_REVIEW_PERMISSION_DENIED' using errcode='42501';
 end if;
 if p_decision not in ('verified_identity','rejected','needs_evidence')
    or char_length(btrim(coalesce(p_reason,''))) not between 12 and 800 then
   raise exception 'REFERRAL_REVIEW_INVALID_DECISION' using errcode='22023';
 end if;
 select * into v_attr from public.growth_merchant_application_attributions_v1_229
   where application_id=p_application_id;
 if not found then
   raise exception 'REFERRAL_REVIEW_NOT_FOUND' using errcode='22023';
 end if;
 select * into v_app from public.merchant_applications where id=p_application_id;
 select * into v_merchant from public.merchants where cnpj=v_attr.cnpj;
 if p_decision='verified_identity' then
   if not (coalesce(p_cnpj_match,false) and coalesce(p_owner_match,false)
      and coalesce(p_inviter_valid,false))
      or v_reference is null or char_length(v_reference) not between 8 and 160
      or v_app.status<>'approved' or v_app.cnpj<>v_attr.cnpj
      or v_merchant.id is null or v_merchant.status not in ('active','pending')
      or not exists(select 1 from public.merchant_members mm
          where mm.merchant_id=v_merchant.id
            and mm.user_id=v_app.applicant_user_id
            and mm.member_role='owner' and mm.active)
      or (v_attr.inviter_kind='merchant' and
          (v_attr.inviter_merchant_id is null or v_attr.inviter_merchant_id=v_merchant.id
           or not exists(select 1 from public.merchants im
             where im.id=v_attr.inviter_merchant_id and im.status in ('active','pending'))))
      or (v_attr.inviter_kind='customer' and
          (v_attr.inviter_user_id is null or v_attr.inviter_user_id=v_app.applicant_user_id))
   then raise exception 'REFERRAL_REVIEW_EVIDENCE_INCOMPLETE' using errcode='22023';
   end if;
 end if;
 insert into public.growth_referral_reviews_v1_230(
  application_id,reviewer_user_id,decision,evidence_cnpj_match,
  evidence_owner_match,evidence_inviter_valid,reason,evidence_reference
 ) values(p_application_id,p_actor_user_id,p_decision,
  coalesce(p_cnpj_match,false),coalesce(p_owner_match,false),
  coalesce(p_inviter_valid,false),btrim(p_reason),v_reference) returning id into v_record;
 return jsonb_build_object('recorded',true,'reviewId',v_record,
   'decision',p_decision,'rewardEligible',false,'noPayout',true);
end;
$fn$;
revoke all on function public.admin_review_growth_referral_v1_230(
 uuid,uuid,text,text,boolean,boolean,boolean,text)
 from public,anon,authenticated;
grant execute on function public.admin_review_growth_referral_v1_230(
 uuid,uuid,text,text,boolean,boolean,boolean,text) to service_role;

create or replace function public.admin_growth_referral_review_queue_v1_230(p_actor_user_id uuid)
 returns jsonb language plpgsql stable security invoker
 set search_path=pg_catalog as $fn$
declare v_rows jsonb;
begin
 if not exists(select 1 from public.platform_admins where user_id=p_actor_user_id
   and active and admin_role in ('superadmin','operations','readonly','compliance')) then
   raise exception 'REFERRAL_REVIEW_READ_DENIED' using errcode='42501';
 end if;
 select coalesce(jsonb_agg(jsonb_build_object(
  'applicationId',a.application_id,
  'companyName',app.company_name,
  'cnpjSuffix',right(a.cnpj,4),
  'inviterKind',a.inviter_kind,
  'applicationStatus',app.status,
  'cnpjMatches',(app.cnpj=a.cnpj and m.id is not null),
  'ownerMatches',(owner.user_id is not null),
  'latestDecision',r.decision,
  'latestReviewAt',r.created_at,
  'rewardEligible',false
 ) order by a.created_at desc,a.application_id desc),'[]'::jsonb)
 into v_rows
 from (select * from public.growth_merchant_application_attributions_v1_229
       order by created_at desc,application_id desc limit 50) a
 join public.merchant_applications app on app.id=a.application_id
 left join public.merchants m on m.cnpj=a.cnpj
 left join public.merchant_members owner on owner.merchant_id=m.id
  and owner.user_id=app.applicant_user_id and owner.member_role='owner' and owner.active
 left join lateral (select decision,created_at from public.growth_referral_reviews_v1_230
  where application_id=a.application_id order by created_at desc,id desc limit 1) r on true;
 return jsonb_build_object('source','growth_referral_review_queue_v1_230',
  'readOnly',true,'noPayout',true,'rewardEligible',false,'rows',v_rows);
end;
$fn$;
revoke all on function public.admin_growth_referral_review_queue_v1_230(uuid)
 from public,anon,authenticated;
grant execute on function public.admin_growth_referral_review_queue_v1_230(uuid)
 to service_role;
