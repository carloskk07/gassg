-- TAMÃO V1.264: private uploaded proof for a founder-reported referral payout.
-- Evidence integrity at upload is separate from provider/bank settlement.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('tamao-owner-referral-payout-proofs-v1-264',
       'tamao-owner-referral-payout-proofs-v1-264',false,3145728,
       array['application/pdf','image/png','image/jpeg']::text[])
on conflict(id) do nothing;

create schema if not exists platform_referral_payout_private_v1_264;
revoke all on schema platform_referral_payout_private_v1_264 from public,anon,authenticated;
grant usage on schema platform_referral_payout_private_v1_264 to service_role;

create table public.platform_referral_payout_proofs_v1_264(
 claim_id uuid primary key references public.platform_referral_payout_claims_v1_263(claim_id) on delete cascade,
 object_path text not null unique,
 mime_type text not null check(mime_type in ('application/pdf','image/png','image/jpeg')),
 size_bytes integer not null check(size_bytes between 64 and 3145728),
 sha256 text not null check(sha256 ~ '^[0-9a-f]{64}$'),
 attached_by uuid not null,
 attached_at timestamptz not null default clock_timestamp(),
 check(object_path like claim_id::text||'/%')
);
alter table public.platform_referral_payout_proofs_v1_264 enable row level security;
revoke all on public.platform_referral_payout_proofs_v1_264 from public,anon,authenticated,service_role;

create or replace function platform_referral_payout_private_v1_264.eligible(p_actor uuid,p_claim uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $fn$
declare
 v_claim public.platform_referral_payout_claims_v1_263%rowtype;
 v_existing boolean;
 v_eligible boolean;
begin
 perform platform_referral_payout_private_v1_263.assert_owner(p_actor);
 select * into v_claim from public.platform_referral_payout_claims_v1_263
 where claim_id=p_claim;
 if not found then raise exception 'PAYOUT_PROOF_CLAIM_MISSING' using errcode='P0002';end if;
 select exists(select 1 from public.platform_referral_payout_proofs_v1_264
  where claim_id=p_claim) into v_existing;
 select (not exists(select 1 from public.platform_referral_payout_voids_v1_263
      where claim_id=p_claim) and g.referrer_user_id=v_claim.beneficiary_user_id
    and g.referral_pending_cents=v_claim.amount_cents
    and g.matured_at is not null and g.reversed_at is null)
 into v_eligible from public.order_reward_grants g where g.order_id=v_claim.order_id;
 return jsonb_build_object('source','admin_owner_payout_proof_eligible_v1_264',
  'eligible',coalesce(v_eligible,false),'alreadyAttached',v_existing,
  'expectedHash',v_claim.proof_sha256,
  'bankVerified',false,'cashMoved',false);
end;$fn$;
revoke all on function platform_referral_payout_private_v1_264.eligible(uuid,uuid)
 from public,anon,authenticated,service_role;
grant execute on function platform_referral_payout_private_v1_264.eligible(uuid,uuid) to service_role;

create or replace function platform_referral_payout_private_v1_264.attach(
 p_actor uuid,p_claim uuid,p_path text,p_mime text,p_size integer,p_sha text
) returns jsonb language plpgsql volatile security definer set search_path=pg_catalog as $fn$
declare
 v_claim public.platform_referral_payout_claims_v1_263%rowtype;
 v_old public.platform_referral_payout_proofs_v1_264%rowtype;
 v_ext text;
begin
 perform platform_referral_payout_private_v1_263.assert_owner(p_actor);
 v_ext:=case p_mime when 'application/pdf' then 'pdf'
  when 'image/png' then 'png' when 'image/jpeg' then 'jpg' else null end;
 if p_claim is null or v_ext is null or p_path is null
  or p_path !~ ('^'||p_claim::text||'/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.'||v_ext||'$')
  or p_size not between 64 and 3145728 or p_sha !~ '^[0-9a-f]{64}$'
 then raise exception 'PAYOUT_PROOF_INVALID' using errcode='22023';end if;
 select * into v_claim from public.platform_referral_payout_claims_v1_263
  where claim_id=p_claim for update;
 if not found then raise exception 'PAYOUT_PROOF_CLAIM_MISSING' using errcode='P0002';end if;
 select * into v_old from public.platform_referral_payout_proofs_v1_264
  where claim_id=p_claim;
 if found then
   if v_old.object_path=p_path and v_old.mime_type=p_mime
     and v_old.size_bytes=p_size and v_old.sha256=p_sha
   then return jsonb_build_object('source','admin_owner_payout_proof_attach_v1_264',
    'attached',true,'replayed',true,'bankVerified',false,'cashMoved',false);end if;
   raise exception 'PAYOUT_PROOF_ALREADY_ATTACHED' using errcode='23505';
 end if;
 if exists(select 1 from public.platform_referral_payout_voids_v1_263 where claim_id=p_claim)
   or not exists(select 1 from public.order_reward_grants g
     where g.order_id=v_claim.order_id
      and g.referrer_user_id=v_claim.beneficiary_user_id
      and g.referral_pending_cents=v_claim.amount_cents
      and g.matured_at is not null and g.reversed_at is null)
 then raise exception 'PAYOUT_PROOF_INELIGIBLE' using errcode='42501';end if;
 if v_claim.proof_sha256 is not null and v_claim.proof_sha256<>p_sha
 then raise exception 'PAYOUT_PROOF_LEGACY_HASH_MISMATCH' using errcode='22023';end if;
 if not exists(select 1 from storage.objects o
   where o.bucket_id='tamao-owner-referral-payout-proofs-v1-264'
     and o.name=p_path)
 then raise exception 'PAYOUT_PROOF_STORAGE_MISSING' using errcode='P0002';end if;
 insert into public.platform_referral_payout_proofs_v1_264(
  claim_id,object_path,mime_type,size_bytes,sha256,attached_by
 )values(p_claim,p_path,p_mime,p_size,p_sha,p_actor);
 return jsonb_build_object('source','admin_owner_payout_proof_attach_v1_264',
  'attached',true,'replayed',false,'bankVerified',false,'cashMoved',false);
end;$fn$;
revoke all on function platform_referral_payout_private_v1_264.attach(
 uuid,uuid,text,text,integer,text) from public,anon,authenticated,service_role;
grant execute on function platform_referral_payout_private_v1_264.attach(
 uuid,uuid,text,text,integer,text) to service_role;

create or replace function platform_referral_payout_private_v1_264.path(
 p_actor uuid,p_claim uuid
) returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $fn$
declare v_proof public.platform_referral_payout_proofs_v1_264%rowtype;
begin
 if p_actor is null or not exists(
  select 1 from public.platform_admins a where a.user_id=p_actor and a.active
   and a.admin_role in ('superadmin','finance'))
 then raise exception 'PAYOUT_PROOF_READ_DENIED' using errcode='42501';end if;
 select * into v_proof from public.platform_referral_payout_proofs_v1_264
 where claim_id=p_claim;
 if not found then raise exception 'PAYOUT_PROOF_NOT_FOUND' using errcode='P0002';end if;
 return jsonb_build_object('source','admin_owner_payout_proof_path_v1_264',
  'claimId',p_claim,'objectPath',v_proof.object_path,'mimeType',v_proof.mime_type,
  'sizeBytes',v_proof.size_bytes,'sha256',v_proof.sha256,'bankVerified',false);
end;$fn$;
revoke all on function platform_referral_payout_private_v1_264.path(uuid,uuid)
 from public,anon,authenticated,service_role;
grant execute on function platform_referral_payout_private_v1_264.path(uuid,uuid) to service_role;

create or replace function platform_referral_payout_private_v1_264.read(
 p_actor uuid,p_month date default null
) returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $fn$
declare
 v_month date:=coalesce(p_month,date_trunc('month',
 clock_timestamp() at time zone 'America/Sao_Paulo')::date);
 v_total bigint;v_with bigint;v_rows jsonb;
begin
 if p_actor is null or not exists(select 1 from public.platform_admins a
 where a.user_id=p_actor and a.active and a.admin_role in ('superadmin','finance'))
 then raise exception 'PAYOUT_PROOF_READ_DENIED' using errcode='42501';end if;
 if extract(day from v_month)<>1 or v_month<date '2026-01-01'
 or v_month>(date_trunc('month',clock_timestamp() at time zone 'America/Sao_Paulo')
  +interval '2 months')::date then raise exception 'PAYOUT_PROOF_MONTH_INVALID' using errcode='22023';end if;
 select count(*)::bigint,
  count(p.claim_id)::bigint into v_total,v_with
 from public.platform_referral_payout_claims_v1_263 c
 left join public.platform_referral_payout_proofs_v1_264 p on p.claim_id=c.claim_id
 where c.paid_on>=v_month and c.paid_on<(v_month+interval '1 month')::date;
 with selected as (
  select c.claim_id,c.reported_at,p.attached_at,p.size_bytes,p.mime_type,p.sha256,
    (v.claim_id is not null) as voided
  from public.platform_referral_payout_claims_v1_263 c
  left join public.platform_referral_payout_proofs_v1_264 p on p.claim_id=c.claim_id
  left join public.platform_referral_payout_voids_v1_263 v on v.claim_id=c.claim_id
  where c.paid_on>=v_month and c.paid_on<(v_month+interval '1 month')::date
  order by c.reported_at desc,c.claim_id limit 30
 )
 select coalesce(jsonb_agg(jsonb_build_object(
  'claimId',claim_id,'attached',attached_at is not null,
  'sizeBytes',size_bytes,'mimeType',mime_type,'sha256',sha256,
  'uploadedAt',attached_at,'voided',voided
 )order by reported_at desc,claim_id),'[]'::jsonb) into v_rows
 from selected;
 return jsonb_build_object('source','admin_owner_payout_proofs_read_v1_264',
  'month',v_month,'timezone','America/Sao_Paulo','totalClaims',v_total,
  'withProof',v_with,'withoutProof',v_total-v_with,
  'limit',30,'truncated',v_total>30,'rows',v_rows,
  'privateBucket',true,'readOnly',true,'verifiedBytesAtUpload',true,
  'bankVerified',false,'providerConfirmed',false,'paidBenefitsCents',null,
  'transferExecuted',false);
end;$fn$;
revoke all on function platform_referral_payout_private_v1_264.read(uuid,date)
 from public,anon,authenticated,service_role;
grant execute on function platform_referral_payout_private_v1_264.read(uuid,date) to service_role;

create or replace function public.admin_owner_payout_proof_eligible_v1_264(p_actor uuid,p_claim uuid)
 returns jsonb language sql stable security invoker set search_path=pg_catalog as $w$
 select platform_referral_payout_private_v1_264.eligible($1,$2)$w$;
create or replace function public.admin_owner_payout_proof_attach_v1_264(
 p_actor uuid,p_claim uuid,p_path text,p_mime text,p_size integer,p_sha text)
 returns jsonb language sql volatile security invoker set search_path=pg_catalog as $w$
 select platform_referral_payout_private_v1_264.attach($1,$2,$3,$4,$5,$6)$w$;
create or replace function public.admin_owner_payout_proof_path_v1_264(p_actor uuid,p_claim uuid)
 returns jsonb language sql stable security invoker set search_path=pg_catalog as $w$
 select platform_referral_payout_private_v1_264.path($1,$2)$w$;
create or replace function public.admin_owner_payout_proofs_read_v1_264(p_actor uuid,p_month date default null)
 returns jsonb language sql stable security invoker set search_path=pg_catalog as $w$
 select platform_referral_payout_private_v1_264.read($1,$2)$w$;
revoke all on function public.admin_owner_payout_proof_eligible_v1_264(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.admin_owner_payout_proof_attach_v1_264(uuid,uuid,text,text,integer,text) from public,anon,authenticated,service_role;
revoke all on function public.admin_owner_payout_proof_path_v1_264(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.admin_owner_payout_proofs_read_v1_264(uuid,date) from public,anon,authenticated,service_role;
grant execute on function public.admin_owner_payout_proof_eligible_v1_264(uuid,uuid) to service_role;
grant execute on function public.admin_owner_payout_proof_attach_v1_264(uuid,uuid,text,text,integer,text) to service_role;
grant execute on function public.admin_owner_payout_proof_path_v1_264(uuid,uuid) to service_role;
grant execute on function public.admin_owner_payout_proofs_read_v1_264(uuid,date) to service_role;
do $acl$begin
 if has_function_privilege('anon','public.admin_owner_payout_proof_attach_v1_264(uuid,uuid,text,text,integer,text)','EXECUTE')
 or has_function_privilege('authenticated','public.admin_owner_payout_proof_attach_v1_264(uuid,uuid,text,text,integer,text)','EXECUTE')
 or has_function_privilege('anon','public.admin_owner_payout_proof_eligible_v1_264(uuid,uuid)','EXECUTE')
 or has_function_privilege('authenticated','public.admin_owner_payout_proof_path_v1_264(uuid,uuid)','EXECUTE')
 or has_function_privilege('authenticated','public.admin_owner_payout_proofs_read_v1_264(uuid,date)','EXECUTE')
 or not has_function_privilege('service_role','public.admin_owner_payout_proof_attach_v1_264(uuid,uuid,text,text,integer,text)','EXECUTE')
 then raise exception 'PAYOUT_PROOF_ACL_DRIFT' using errcode='42501';end if;
end$acl$;