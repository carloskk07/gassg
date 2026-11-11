-- V1.948: owner-only lifecycle for the already funded R$1 / first 100 campaign.
-- No PSP, transfers, charges, new awards, direct wallet adjustments or top-ups.
-- A future increase beyond the first 100 requires a separate approved campaign.
alter table public.platform_welcome_campaign_v1_815
 add column if not exists ended_at timestamptz;

create or replace function public.admin_welcome_campaign_read_v1_948(p_actor uuid)
returns jsonb language plpgsql stable security definer
set search_path=pg_catalog as $function$
declare
 v_c public.platform_welcome_campaign_v1_815%rowtype;
 v_count bigint;
 v_issued bigint;
 v_lot_count bigint;
 v_lot_remaining bigint;
 v_bad_lots bigint;
 v_history jsonb;
begin
 if public.platform_admin_role(p_actor) not in ('superadmin','finance') then
   raise exception 'ADMIN_PERMISSION_DENIED' using errcode='42501';
 end if;
 select * into strict v_c from public.platform_welcome_campaign_v1_815
 where campaign_key='welcome_2026_815';
 select count(*),coalesce(sum(g.amount_cents),0),
        count(l.lot_id),coalesce(sum(l.remaining_cents),0),
        count(*) filter(where l.lot_id is null or
          l.user_id is distinct from g.user_id or
          l.issued_cents is distinct from g.amount_cents or
          l.remaining_cents<0 or l.remaining_cents>l.issued_cents)
 into v_count,v_issued,v_lot_count,v_lot_remaining,v_bad_lots
 from public.platform_welcome_grants_v1_815 g
 left join public.platform_cashback_source_lots_v1_261 l
  on l.lot_id=g.wallet_entry_id
 where g.campaign_key=v_c.campaign_key;
 if v_bad_lots>0 or v_count<>v_c.awarded_count or
    v_issued<>v_c.awarded_cents or v_lot_count<>v_count then
   raise exception 'WELCOME_LEDGER_RECONCILIATION_REQUIRED' using errcode='40001';
 end if;
 select coalesce(jsonb_agg(jsonb_build_object(
   'action',a.metadata->>'operation',
   'awardedCount',a.metadata->'awardedCount',
   'createdAt',a.created_at,
   'beforeEnabled',a.metadata->'beforeEnabled',
   'afterEnabled',a.metadata->'afterEnabled'
 ) order by a.created_at desc),'[]'::jsonb)
 into v_history
 from (select created_at,metadata from public.platform_admin_audit
  where target_type='welcome_campaign' and
    target_id='welcome_2026_815' and action='welcome_campaign_control_v1_948'
  order by created_at desc limit 20) a;
 return jsonb_build_object(
  'source','admin_welcome_campaign_read_v1_948',
  'readOnly',true,'noCharge',true,'pspCashVerified',false,
  'funding','owner_promotional_commitment_not_bank_receipt',
  'campaignKey',v_c.campaign_key,
  'enabled',v_c.enabled,'ended',v_c.ended_at is not null,
  'awardCents',v_c.award_cents,'budgetCents',v_c.budget_cents,
  'maxAwards',v_c.max_awards,'awardedCount',v_c.awarded_count,
  'awardedCents',v_c.awarded_cents,
  'remainingAwards',greatest(0,least(v_c.max_awards-v_c.awarded_count,
   (v_c.budget_cents-v_c.awarded_cents)/v_c.award_cents)),
  'lotRemainingCents',v_lot_remaining,
  'notAvailableCents',v_issued-v_lot_remaining,
  'history',v_history);
end;
$function$;

create or replace function public.admin_welcome_campaign_manage_v1_948(
 p_actor uuid,p_operation text,p_expected_awarded integer,
 p_expected_enabled boolean,p_request uuid)
returns jsonb language plpgsql security definer
set search_path=pg_catalog as $function$
declare
 v_c public.platform_welcome_campaign_v1_815%rowtype;
 v_original_enabled boolean;
 v_replay public.platform_admin_audit%rowtype;
 v_changed boolean:=true;
begin
 if public.platform_admin_role(p_actor)<>'superadmin' then
   raise exception 'ADMIN_PERMISSION_DENIED' using errcode='42501';
 end if;
 if p_operation not in ('pause','resume','end') or p_request is null or
    p_expected_awarded is null or p_expected_enabled is null then
   raise exception 'WELCOME_ACTION_INVALID' using errcode='22023';
 end if;
 select * into strict v_c from public.platform_welcome_campaign_v1_815
  where campaign_key='welcome_2026_815' for update;
 select * into v_replay from public.platform_admin_audit where id=p_request;
 if found then
   if v_replay.actor_user_id is distinct from p_actor or
      v_replay.target_type is distinct from 'welcome_campaign' or
      v_replay.target_id is distinct from v_c.campaign_key or
      v_replay.action is distinct from 'welcome_campaign_control_v1_948' or
      v_replay.metadata->>'operation' is distinct from p_operation then
      raise exception 'WELCOME_REQUEST_REPLAY_CONFLICT' using errcode='23505';
   end if;
   return jsonb_build_object('source','admin_welcome_campaign_manage_v1_948',
    'replayed',true,'noCharge',true,'changed',
    (v_replay.metadata->>'changed')::boolean,
    'enabled',v_c.enabled,'ended',v_c.ended_at is not null,
    'awardedCount',v_c.awarded_count);
 end if;
 if v_c.awarded_count<>p_expected_awarded or
    v_c.enabled is distinct from p_expected_enabled then
   raise exception 'WELCOME_CAMPAIGN_STALE_RELOAD' using errcode='40001';
 end if;
 if v_c.ended_at is not null and p_operation<>'end' then
   raise exception 'WELCOME_CAMPAIGN_PERMANENTLY_ENDED' using errcode='40001';
 end if;
 if p_operation='resume' and
  (v_c.awarded_count>=v_c.max_awards or
   v_c.awarded_cents+v_c.award_cents>v_c.budget_cents or
   v_c.starts_at is null) then
   raise exception 'WELCOME_CAMPAIGN_CANNOT_RESUME' using errcode='40001';
 end if;
 v_original_enabled:=v_c.enabled;
 if p_operation='pause' then
   v_changed:=v_c.enabled;
   update public.platform_welcome_campaign_v1_815
   set enabled=false where campaign_key=v_c.campaign_key;
 elsif p_operation='resume' then
   v_changed:=not v_c.enabled;
   update public.platform_welcome_campaign_v1_815
   set enabled=true where campaign_key=v_c.campaign_key;
 else
   v_changed:=v_c.ended_at is null;
   update public.platform_welcome_campaign_v1_815
    set enabled=false,ended_at=coalesce(ended_at,clock_timestamp())
   where campaign_key=v_c.campaign_key;
 end if;
 insert into public.platform_admin_audit(
   id,actor_user_id,action,target_type,target_id,metadata)
 values(
   p_request,p_actor,'welcome_campaign_control_v1_948',
   'welcome_campaign',v_c.campaign_key,
   jsonb_build_object('operation',p_operation,
    'awardedCount',v_c.awarded_count,
    'beforeEnabled',v_original_enabled,
    'afterEnabled',p_operation='resume','changed',v_changed,
    'financialEffect',false,'pspCashVerified',false));
 return jsonb_build_object('source','admin_welcome_campaign_manage_v1_948',
  'replayed',false,'noCharge',true,'changed',v_changed,
  'enabled',p_operation='resume',
  'ended',p_operation='end' or v_c.ended_at is not null,
  'awardedCount',v_c.awarded_count);
end;
$function$;

-- The original public read/status and authenticated claim endpoints keep
-- their existing grants. Admin mutation/read are Edge service-role only.
revoke all on function public.admin_welcome_campaign_read_v1_948(uuid)
 from public,anon,authenticated;
revoke all on function public.admin_welcome_campaign_manage_v1_948(uuid,text,integer,boolean,uuid)
 from public,anon,authenticated;
grant execute on function public.admin_welcome_campaign_read_v1_948(uuid)
 to service_role;
grant execute on function public.admin_welcome_campaign_manage_v1_948(uuid,text,integer,boolean,uuid)
 to service_role;
