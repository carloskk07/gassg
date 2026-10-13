-- TAMÃO V1.230 — append-only administrative referral evidence and review.
-- Never modifies first-touch attribution and never grants a financial benefit.
create table if not exists public.growth_referral_reviews_v1_230 (
 id uuid primary key default gen_random_uuid(),
 request_id uuid not null unique,
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
-- Exactly one terminal decision for each application, independent of concurrency.
create unique index if not exists growth_referral_one_final_v1_230
 on public.growth_referral_reviews_v1_230(application_id)
 where decision in ('verified_identity','rejected');
alter table public.growth_referral_reviews_v1_230 enable row level security;
revoke all on table public.growth_referral_reviews_v1_230 from public,anon,authenticated,service_role;
grant select on table public.growth_referral_reviews_v1_230 to service_role;
-- Privileged INSERT is confined to a non-exposed schema. Only service_role
-- may invoke the public SECURITY INVOKER facade through the authenticated Edge API.
create schema if not exists growth_internal_v1_230;
revoke all on schema growth_internal_v1_230 from public,anon,authenticated;
grant usage on schema growth_internal_v1_230 to service_role;

create or replace function growth_internal_v1_230.admin_review_growth_referral_v1_230(
 p_actor_user_id uuid,p_application_id uuid,p_request_id uuid,p_decision text,
 p_reason text,p_evidence_reference text
) returns jsonb language plpgsql volatile security definer
set search_path=pg_catalog as $fn$
declare
 v_attr public.growth_merchant_application_attributions_v1_229%rowtype;
 v_app public.merchant_applications%rowtype;
 v_merchant public.merchants%rowtype;
 v_old public.growth_referral_reviews_v1_230%rowtype;
 v_record uuid;
 v_reference text:=nullif(btrim(coalesce(p_evidence_reference,'')),'');
 v_reason text:=btrim(coalesce(p_reason,''));
 v_cnpj_ok boolean:=false;
 v_owner_ok boolean:=false;
 v_inviter_ok boolean:=false;
begin
 if not exists(select 1 from public.platform_admins
    where user_id=p_actor_user_id and active
      and admin_role in ('superadmin','compliance')) then
   raise exception 'REFERRAL_REVIEW_PERMISSION_DENIED' using errcode='42501';
 end if;
 if p_request_id is null or p_application_id is null or p_decision is null
    or p_decision not in ('verified_identity','rejected','needs_evidence')
    or char_length(v_reason) not between 12 and 800
    or (v_reference is not null and char_length(v_reference) not between 8 and 160) then
   raise exception 'REFERRAL_REVIEW_INVALID_DECISION' using errcode='22023';
 end if;

 -- Serialize all review attempts for the same application. No first-touch
 -- attribution rows are modified. Retry with same request_id is idempotent.
 perform pg_catalog.pg_advisory_xact_lock(
   pg_catalog.hashtextextended(p_application_id::text,230));
 select * into v_old from public.growth_referral_reviews_v1_230
   where request_id=p_request_id;
 if found then
   if v_old.application_id<>p_application_id or
      v_old.reviewer_user_id<>p_actor_user_id or
      v_old.decision<>p_decision or v_old.reason<>v_reason or
      v_old.evidence_reference is distinct from v_reference then
     raise exception 'REFERRAL_REVIEW_REQUEST_ID_REUSED' using errcode='23505';
   end if;
   return jsonb_build_object('recorded',true,'idempotent',true,
     'reviewId',v_old.id,'decision',v_old.decision,
     'rewardEligible',false,'noPayout',true);
 end if;
 if exists(select 1 from public.growth_referral_reviews_v1_230
   where application_id=p_application_id
     and decision in ('verified_identity','rejected')) then
   raise exception 'REFERRAL_REVIEW_ALREADY_FINAL' using errcode='23505';
 end if;
 select * into v_attr from public.growth_merchant_application_attributions_v1_229
   where application_id=p_application_id;
 if not found then
   raise exception 'REFERRAL_REVIEW_NOT_FOUND' using errcode='22023';
 end if;
 select * into v_app from public.merchant_applications
   where id=p_application_id;
 select * into v_merchant from public.merchants
   where cnpj=v_attr.cnpj;
 v_cnpj_ok:=v_app.id is not null and v_merchant.id is not null
   and v_app.cnpj=v_attr.cnpj
   and v_app.status='approved'
   and v_merchant.status in ('active','pending');
 v_owner_ok:=v_merchant.id is not null and exists(
   select 1 from public.merchant_members mm
   where mm.merchant_id=v_merchant.id
     and mm.user_id=v_app.applicant_user_id
     and mm.member_role='owner' and mm.active);
 if v_attr.inviter_kind='merchant' then
   v_inviter_ok:=v_attr.inviter_merchant_id is not null
     and v_attr.inviter_merchant_id is distinct from v_merchant.id
     and exists(select 1 from public.growth_merchant_invites_v1_226 i
       join public.merchants im on im.id=i.merchant_id
       where i.invite_code=v_attr.referral_code
         and i.merchant_id=v_attr.inviter_merchant_id
         and im.cnpj<>v_attr.cnpj
         and im.status in ('active','pending'))
     and not exists(select 1 from public.merchant_members mm
       where mm.merchant_id=v_attr.inviter_merchant_id
       and mm.user_id=v_app.applicant_user_id and mm.active);
 elsif v_attr.inviter_kind='customer' then
   v_inviter_ok:=v_attr.inviter_user_id is not null
     and v_attr.inviter_user_id<>v_app.applicant_user_id
     and exists(select 1 from public.profiles p
       where p.user_id=v_attr.inviter_user_id
         and upper(p.referral_code)=v_attr.referral_code)
     and not exists(select 1 from public.merchant_members mm
       where mm.merchant_id=v_merchant.id
         and mm.user_id=v_attr.inviter_user_id and mm.active);
 end if;
 if p_decision='verified_identity' and
   (not (coalesce(v_cnpj_ok,false) and coalesce(v_owner_ok,false) and coalesce(v_inviter_ok,false))
    or v_reference is null) then
   raise exception 'REFERRAL_REVIEW_EVIDENCE_INCOMPLETE' using errcode='22023';
 end if;
 insert into public.growth_referral_reviews_v1_230(
  request_id,application_id,reviewer_user_id,decision,
  evidence_cnpj_match,evidence_owner_match,evidence_inviter_valid,
  reason,evidence_reference
 ) values(p_request_id,p_application_id,p_actor_user_id,p_decision,
   v_cnpj_ok,v_owner_ok,v_inviter_ok,v_reason,v_reference)
 returning id into v_record;
 return jsonb_build_object('recorded',true,'idempotent',false,
  'reviewId',v_record,'decision',p_decision,'rewardEligible',false,'noPayout',true);
end;
$fn$;
revoke all on function growth_internal_v1_230.admin_review_growth_referral_v1_230(
 uuid,uuid,uuid,text,text,text) from public,anon,authenticated,service_role;
grant execute on function growth_internal_v1_230.admin_review_growth_referral_v1_230(
 uuid,uuid,uuid,text,text,text) to service_role;

-- Public RPC contains no elevated SQL and cannot be invoked by visitors.
create or replace function public.admin_review_growth_referral_v1_230(
 p_actor_user_id uuid,p_application_id uuid,p_request_id uuid,p_decision text,
 p_reason text,p_evidence_reference text
) returns jsonb language sql volatile security invoker
set search_path=pg_catalog as $wrapper$
 select growth_internal_v1_230.admin_review_growth_referral_v1_230($1,$2,$3,$4,$5,$6)
$wrapper$;
revoke all on function public.admin_review_growth_referral_v1_230(
 uuid,uuid,uuid,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.admin_review_growth_referral_v1_230(
 uuid,uuid,uuid,text,text,text) to service_role;

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

-- Fail a migration whose effective ACL unexpectedly exposes review writes.
do $acl$
begin
 if has_table_privilege('anon','public.growth_referral_reviews_v1_230','SELECT')
 or has_table_privilege('authenticated','public.growth_referral_reviews_v1_230','INSERT')
 or has_table_privilege('service_role','public.growth_referral_reviews_v1_230','INSERT')
 or has_table_privilege('service_role','public.growth_referral_reviews_v1_230','UPDATE')
 or has_table_privilege('service_role','public.growth_referral_reviews_v1_230','DELETE')
 or not has_function_privilege('service_role',
   'public.admin_review_growth_referral_v1_230(uuid,uuid,uuid,text,text,text)','EXECUTE')
 or has_function_privilege('anon',
   'public.admin_review_growth_referral_v1_230(uuid,uuid,uuid,text,text,text)','EXECUTE')
 or has_function_privilege('authenticated',
   'public.admin_review_growth_referral_v1_230(uuid,uuid,uuid,text,text,text)','EXECUTE')
 then
   raise exception 'REFERRAL_REVIEW_EFFECTIVE_ACL_DRIFT' using errcode='42501';
 end if;
end;
$acl$;
