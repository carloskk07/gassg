-- TAMÃO V1.337 — immutable, strictly administrative payout-review journal.
-- Event states are workflow notes ONLY. They never certify a PSP transfer,
-- bank settlement, beneficiary ownership, payout execution, or debt recovery.
create table if not exists public.platform_referral_payout_review_events_v1_337(
 event_id bigint generated always as identity primary key,
 claim_id uuid not null references public.platform_referral_payout_claims_v1_263(claim_id),
 request_id uuid not null,
 actor_id uuid not null references auth.users(id),
 review_state text not null check (review_state in (
   'in_review','awaiting_evidence','reviewed_no_bank_proof','closed_administrative')),
 justification text not null check (
   char_length(btrim(justification)) between 20 and 1000),
 created_at timestamptz not null default clock_timestamp(),
 constraint payout_review_claim_request_unique_v1_337 unique(claim_id,request_id)
);
create index if not exists payout_review_events_by_claim_v1_337
 on public.platform_referral_payout_review_events_v1_337(claim_id,event_id desc);
alter table public.platform_referral_payout_review_events_v1_337 enable row level security;
revoke all on public.platform_referral_payout_review_events_v1_337 from public,anon,authenticated;
revoke all on public.platform_referral_payout_review_events_v1_337 from service_role;
revoke all on sequence public.platform_referral_payout_review_events_v1_337_event_id_seq from public,anon,authenticated,service_role;

create or replace function public.prevent_payout_review_event_mutation_v1_337()
returns trigger language plpgsql security definer
set search_path to 'pg_catalog' as $guard$
begin
 raise exception 'PAYOUT_REVIEW_JOURNAL_IMMUTABLE' using errcode='23514';
end;$guard$;
create trigger payout_review_immutable_v1_337
before update or delete on public.platform_referral_payout_review_events_v1_337
for each row execute function public.prevent_payout_review_event_mutation_v1_337();

create or replace function public.admin_owner_payout_review_record_v1_337(
 p_actor uuid,p_claim uuid,p_request uuid,p_state text,p_justification text
) returns jsonb language plpgsql volatile security definer
set search_path to 'pg_catalog' as $function$
declare
 v public.platform_referral_payout_review_events_v1_337%rowtype;
 v_note text:=btrim(coalesce(p_justification,''));
begin
 if p_actor is null or not exists(
   select 1 from public.platform_admins a
   where a.user_id=p_actor and a.active and a.admin_role='superadmin'
 ) then raise exception 'PAYOUT_REVIEW_WRITE_DENIED' using errcode='42501';end if;
 if p_claim is null or p_request is null or p_state not in (
   'in_review','awaiting_evidence','reviewed_no_bank_proof','closed_administrative'
 ) or p_state is null or char_length(v_note) not between 20 and 1000 then
   raise exception 'PAYOUT_REVIEW_INPUT_INVALID' using errcode='22023';end if;
 if not exists(select 1 from public.platform_referral_payout_claims_v1_263 c
               where c.claim_id=p_claim) then
   raise exception 'PAYOUT_REVIEW_CLAIM_NOT_FOUND' using errcode='22023';end if;
 perform pg_catalog.pg_advisory_xact_lock(
   pg_catalog.hashtextextended('payout-review:'||p_claim::text,0));
 select * into v from public.platform_referral_payout_review_events_v1_337 e
 where e.claim_id=p_claim and e.request_id=p_request;
 if found then
   if v.actor_id<>p_actor or v.review_state<>p_state or v.justification<>v_note then
     raise exception 'PAYOUT_REVIEW_REQUEST_CONFLICT' using errcode='23505';end if;
 else
   insert into public.platform_referral_payout_review_events_v1_337(
     claim_id,request_id,actor_id,review_state,justification
   ) values(p_claim,p_request,p_actor,p_state,v_note)
   returning * into v;
 end if;
 return pg_catalog.jsonb_build_object(
   'source','admin_payout_review_record_v1_337',
   'claimId',v.claim_id,'eventId',v.event_id::text,
   'requestId',v.request_id,'reviewState',v.review_state,
   'justification',v.justification,'recordedAt',v.created_at,
   'administrativeOnly',true,'bankSettlementVerified',false,
   'recipientVerified',false,'moneyMoved',false);
end;$function$;

create or replace function public.admin_owner_payout_review_read_v1_337(
 p_actor uuid,p_claim uuid
) returns jsonb language plpgsql stable security definer
set search_path to 'pg_catalog' as $function$
declare
 v_count bigint;v_events jsonb;v_latest text;
begin
 if p_actor is null or not exists(
  select 1 from public.platform_admins a
  where a.user_id=p_actor and a.active and a.admin_role in ('superadmin','finance')
 ) then raise exception 'PAYOUT_REVIEW_READ_DENIED' using errcode='42501';end if;
 if p_claim is null or not exists(
  select 1 from public.platform_referral_payout_claims_v1_263 c where c.claim_id=p_claim
 ) then raise exception 'PAYOUT_REVIEW_CLAIM_NOT_FOUND' using errcode='22023';end if;
 select count(*) into v_count
 from public.platform_referral_payout_review_events_v1_337
 where claim_id=p_claim;
 with recent as (
   select event_id,actor_id,review_state,justification,created_at
   from public.platform_referral_payout_review_events_v1_337
   where claim_id=p_claim order by event_id desc limit 100
 )
 select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
   'eventId',event_id::text,'actorId',actor_id,'reviewState',review_state,
   'justification',justification,'recordedAt',created_at
 ) order by event_id desc),'[]'::jsonb) into v_events from recent;
 select e.review_state into v_latest
 from public.platform_referral_payout_review_events_v1_337 e
 where e.claim_id=p_claim order by e.event_id desc limit 1;
 return pg_catalog.jsonb_build_object(
  'source','admin_payout_review_history_v1_337','claimId',p_claim,
  'currentAdministrativeState',coalesce(v_latest,'not_started'),
  'totalEvents',v_count,'truncated',v_count>100,'limit',100,
  'events',v_events,'readOnly',true,'administrativeOnly',true,
  'bankSettlementVerified',false,'recipientVerified',false,'moneyMoved',false);
end;$function$;

revoke all on function public.prevent_payout_review_event_mutation_v1_337() from public,anon,authenticated,service_role;
revoke all on function public.admin_owner_payout_review_record_v1_337(uuid,uuid,uuid,text,text)
 from public,anon,authenticated;
revoke all on function public.admin_owner_payout_review_read_v1_337(uuid,uuid)
 from public,anon,authenticated;
grant execute on function public.admin_owner_payout_review_record_v1_337(uuid,uuid,uuid,text,text)
 to service_role;
grant execute on function public.admin_owner_payout_review_read_v1_337(uuid,uuid)
 to service_role;
notify pgrst,'reload schema';
