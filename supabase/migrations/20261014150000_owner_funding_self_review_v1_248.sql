-- TAMÃO V1.248 — founder-led internal review of funding evidence.
-- The active superadmin can check their own contribution; finance self-review stays blocked.
-- This does NOT authorize spending, cashback, coupons, balances or bank confirmation.
-- Keep V1.246 as immutable history; apply this forward-only migration.

do $migration$
declare v_constraint text;
declare v_count integer;
begin
  -- Drop ONLY V1.246's independent-review CHECK; all financial guards remain.
  select count(*), min(c.conname) into v_count,v_constraint
  from pg_catalog.pg_constraint c
  where c.conrelid='public.platform_owner_contributions_v1_246'::regclass
    and c.contype='c'
    and pg_catalog.pg_get_constraintdef(c.oid) ilike '%reviewer_id%'
    and pg_catalog.pg_get_constraintdef(c.oid) ilike '%submitted_by%';
  -- Some deployments already ran the equivalent V1.248 correction.
  -- In that case the restrictive CHECK no longer exists; continue safely.
  if v_count>1 then
    raise exception 'OWNER_EVIDENCE_SELF_REVIEW_CONSTRAINT_DRIFT' using errcode='23514';
  end if;
  if v_count=1 then
    execute pg_catalog.format(
      'alter table public.platform_owner_contributions_v1_246 drop constraint %I',v_constraint);
  end if;
end $migration$;

create or replace function platform_funding_private_v1_246.review(
 p_actor uuid,p_contribution uuid,p_action text,p_expected_version integer,
 p_note text,p_statement_reference text,p_request uuid
) returns jsonb language plpgsql volatile security definer
set search_path=pg_catalog as $func$
declare
 v_prev public.platform_owner_contributions_v1_246%rowtype;
 v_event public.platform_owner_contribution_events_v1_246%rowtype;
 v_sig jsonb;
 v_replayed boolean:=false;
begin
 if p_actor is null or not exists(select 1 from public.platform_admins a
   where a.user_id=p_actor and a.active and a.admin_role in ('superadmin','finance'))
 then raise exception 'OWNER_EVIDENCE_REVIEW_DENIED' using errcode='42501';end if;
 if p_contribution is null or p_request is null or
  p_action is null or p_action not in ('manual_reconciled','rejected','disputed') or
  p_expected_version is null or p_expected_version<1 or
  p_note is null or char_length(btrim(p_note)) not between 12 and 300 or
  (p_action='manual_reconciled' and
   (p_statement_reference is null or
    char_length(btrim(p_statement_reference)) not between 12 and 100 or
    btrim(p_statement_reference) !~ '^[a-zA-Z0-9 .:/_-]+$')) or
  (p_action<>'manual_reconciled' and nullif(btrim(coalesce(p_statement_reference,'')),'') is not null)
 then raise exception 'OWNER_EVIDENCE_REVIEW_INVALID' using errcode='22023';end if;
 v_sig:=jsonb_build_object('action',p_action,'contribution',p_contribution,
  'version',p_expected_version,'note',btrim(p_note),
  'statementReference',nullif(btrim(coalesce(p_statement_reference,'')),''));
 perform pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('owner-evidence-v1-246:'||p_contribution::text,0));
 select * into v_event from public.platform_owner_contribution_events_v1_246
  where request_id=p_request;
 if found then
  if v_event.actor_id<>p_actor or v_event.action<>'review' or
     v_event.request_signature is distinct from v_sig
  then raise exception 'OWNER_EVIDENCE_REVIEW_REPLAY_CONFLICT' using errcode='23505';end if;
  v_replayed:=true;
 end if;
 select * into v_prev from public.platform_owner_contributions_v1_246
  where contribution_id=p_contribution;
 if not found then raise exception 'OWNER_EVIDENCE_NOT_FOUND' using errcode='22023';end if;
 -- Only the active superadmin may review their own declared contribution.
 -- Finance users still require another authorized reviewer.
 if v_prev.submitted_by=p_actor and not exists(
   select 1 from public.platform_admins a
   where a.user_id=p_actor and a.active and a.admin_role='superadmin'
 ) then
  raise exception 'OWNER_EVIDENCE_INDEPENDENT_REVIEW_REQUIRED' using errcode='42501';end if;
 if not v_replayed then
  if v_prev.version<>p_expected_version or
    (v_prev.status<>'pending_review' and
      not (v_prev.status='manual_reconciled' and p_action='disputed'))
  then raise exception 'OWNER_EVIDENCE_REVIEW_STALE' using errcode='40001';end if;
  update public.platform_owner_contributions_v1_246 set
   status=p_action,version=version+1,
   reviewer_id=p_actor,reviewed_at=clock_timestamp(),
   reviewer_note=btrim(p_note),
   bank_statement_reference=case when p_action='manual_reconciled'
    then btrim(p_statement_reference) else null end
   where contribution_id=p_contribution;
  insert into public.platform_owner_contribution_events_v1_246(
   request_id,contribution_id,actor_id,action,request_signature,
   from_version,to_version
  )values(p_request,p_contribution,p_actor,'review',v_sig,
   v_prev.version,v_prev.version+1);
 end if;
 return jsonb_build_object('source','admin_owner_evidence_review_v1_246',
  'recorded',true,'replayed',v_replayed,'reviewStatus',p_action,
  'bankApiConfirmed',false,'fundsSpendable',false,
  'newBenefitsEnabled',false,'cashMoved',false);
end;$func$;


-- Reaffirm minimum executable roles; no direct Data API table writes.
revoke all on function platform_funding_private_v1_246.review(uuid,uuid,text,integer,text,text,uuid)
 from public,anon,authenticated,service_role;
grant execute on function platform_funding_private_v1_246.review(uuid,uuid,text,integer,text,text,uuid)
 to service_role;

do $acl$
begin
 if has_table_privilege('authenticated','public.platform_owner_contributions_v1_246','UPDATE')
   or has_table_privilege('service_role','public.platform_owner_contributions_v1_246','UPDATE')
   or has_function_privilege('authenticated','public.admin_owner_evidence_review_v1_246(uuid,uuid,text,integer,text,text,uuid)','EXECUTE')
 then raise exception 'OWNER_EVIDENCE_V1_248_ACL_DRIFT' using errcode='42501';end if;
end $acl$;
