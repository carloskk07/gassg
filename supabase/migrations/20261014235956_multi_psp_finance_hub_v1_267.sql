-- TAMÃO V1.267: segregated multi-provider evidence overview.
-- Strictly read-only: merchant receipts never become platform payout evidence.
-- Provider-catalog declarations are metadata, NOT proof of a live integration.
create schema if not exists platform_multi_psp_private_v1_267;
revoke all on schema platform_multi_psp_private_v1_267 from public,anon,authenticated;
grant usage on schema platform_multi_psp_private_v1_267 to service_role;

create or replace function platform_multi_psp_private_v1_267.report(
 p_actor uuid,p_month date default null
) returns jsonb language plpgsql stable security definer
set search_path=pg_catalog as $fn$
declare
 v_month date:=coalesce(p_month,
   date_trunc('month',clock_timestamp() at time zone 'America/Sao_Paulo')::date);
 v_begin timestamptz;
 v_end timestamptz;
 v_merchant jsonb;
 v_outgoing jsonb;
 v_merchant_evidence bigint;
 v_merchant_orders bigint;
 v_outgoing_claims bigint;
 v_outgoing_checked bigint;
begin
 if p_actor is null or not exists(
  select 1 from public.platform_admins a
  where a.user_id=p_actor and a.active
   and a.admin_role in ('superadmin','finance')
 ) then raise exception 'MULTI_PSP_ACCESS_DENIED' using errcode='42501';end if;
 if extract(day from v_month)<>1 or v_month<date '2026-01-01'
  or v_month>(date_trunc('month',clock_timestamp() at time zone 'America/Sao_Paulo')
   +interval '2 months')::date
 then raise exception 'MULTI_PSP_MONTH_INVALID' using errcode='22023';end if;
 v_begin:=v_month::timestamp at time zone 'America/Sao_Paulo';
 v_end:=(v_month+interval '1 month')::timestamp at time zone 'America/Sao_Paulo';

 -- Lane A: merchant-owned customer receipts. The catalog may contain adapter
 -- metadata; only rows in actual verifications are evidence observations.
 with catalog as (
  select provider_key,display_name,adapter_status,supports_lookup,
   supports_webhook,connection_mode,verification_level,funds_flow
  from public.payment_provider_catalog
 ), attempts as (
  select provider,count(*)::bigint attempts
  from public.merchant_sale_payment_attempts
  where created_at>=v_begin and created_at<v_end
  group by provider
 ), evidence as (
  select provider,count(*)::bigint observations,
   count(distinct order_id) filter(
    where status='verified' and verification_level='provider'
     and evidence_type in ('provider_api','provider_webhook')
     and funds_owner='merchant')::bigint provider_verified_orders
  from public.merchant_sale_payment_verifications
  where created_at>=v_begin and created_at<v_end
  group by provider
 )
 select coalesce(jsonb_agg(jsonb_build_object(
  'providerKey',c.provider_key,'displayName',c.display_name,
  'catalogAdapterStatus',c.adapter_status,
  'catalogSupportsLookup',c.supports_lookup,
  'catalogSupportsWebhook',c.supports_webhook,
  'catalogConnectionMode',c.connection_mode,
  'catalogVerificationLevel',c.verification_level,
  'catalogFundsFlow',c.funds_flow,
  'paymentAttempts',coalesce(a.attempts,0),
  'evidenceRecords',coalesce(e.observations,0),
  'providerVerifiedOrders',coalesce(e.provider_verified_orders,0),
  'ownerOfFunds','merchant','outgoingPayoutVerified',false
 )order by c.display_name),'[]'::jsonb)
 into v_merchant from catalog c
 left join attempts a on a.provider=c.provider_key
 left join evidence e on e.provider=c.provider_key;

 select count(*)::bigint,
 count(distinct order_id) filter(where status='verified'
  and verification_level='provider'
  and evidence_type in ('provider_api','provider_webhook')
  and funds_owner='merchant')::bigint
 into v_merchant_evidence,v_merchant_orders
 from public.merchant_sale_payment_verifications
 where created_at>=v_begin and created_at<v_end;

 -- Lane B: owner-reported outbound benefits (not merchant receipts).
 -- Four actual claim-provider categories; only Mercado Pago has an implemented
 -- official read-only outgoing GET in V1.265, which is NOT payee identity proof.
 with catalog(provider_key,display_name,lookup_implemented) as (
  values
   ('mercado_pago'::text,'Mercado Pago Payouts'::text,true),
   ('pix'::text,'Pix — banco/PSP não conectado'::text,false),
   ('bank_transfer'::text,'Transferência bancária — não conectada'::text,false),
   ('other'::text,'Outro provedor — não conectado'::text,false)
 ), c as (
  select x.claim_id,x.provider,x.amount_cents,
    v.claim_id is not null voided,
    p.claim_id is not null attached,
    o.observation_id is not null consulted,
    (o.observation_id is not null
     and o.provider_transaction_success
     and o.reference_matches and o.amount_matches
     and o.transaction_reference=x.provider_reference
     and o.amount_cents=x.amount_cents
     and o.provider_status='success' and o.status_detail='accredited'
     and v.claim_id is null
     and g.order_id is not null
     and g.referrer_user_id=x.beneficiary_user_id
     and g.referral_pending_cents=x.amount_cents
     and g.matured_at is not null and g.reversed_at is null
    ) official_match
  from public.platform_referral_payout_claims_v1_263 x
  left join public.platform_referral_payout_voids_v1_263 v
   on v.claim_id=x.claim_id
  left join public.platform_referral_payout_proofs_v1_264 p
   on p.claim_id=x.claim_id
  left join public.order_reward_grants g
   on g.order_id=x.order_id
  left join lateral (
   select e.* from public.platform_referral_provider_observations_v1_265 e
    where e.claim_id=x.claim_id
    order by e.checked_at desc,e.observation_id desc limit 1
  ) o on true
  where x.paid_on>=v_month and x.paid_on<(v_month+interval '1 month')::date
 ), agg as (
  select provider,count(*)::bigint claims,
   count(*) filter(where not voided)::bigint active,
   count(*) filter(where voided)::bigint voided,
   count(*) filter(where attached)::bigint with_document,
   count(*) filter(where consulted)::bigint checked,
   count(*) filter(where official_match)::bigint matched,
   coalesce(sum(amount_cents) filter(where not voided),0)::bigint declared_cents
  from c group by provider
 )
 select coalesce(jsonb_agg(jsonb_build_object(
   'providerKey',s.provider_key,'displayName',s.display_name,
   'officialOutgoingLookupImplemented',s.lookup_implemented,
   'claims',coalesce(a.claims,0),'activeClaims',coalesce(a.active,0),
   'voidedClaims',coalesce(a.voided,0),
   'withDocument',coalesce(a.with_document,0),
   'officiallyQueried',coalesce(a.checked,0),
   'officialStatusMatched',coalesce(a.matched,0),
   'ownerDeclaredActiveCents',coalesce(a.declared_cents,0),
   'verifiedBeneficiaryClaims',0,'bankVerifiedClaims',0,
   'ownerOfFunds','platform_owner_reported',
   'realTransferProven',false
 )order by s.provider_key),'[]'::jsonb)
 into v_outgoing from catalog s left join agg a on a.provider=s.provider_key;

 select count(*)::bigint into v_outgoing_claims
 from public.platform_referral_payout_claims_v1_263 x
 where x.paid_on>=v_month and x.paid_on<(v_month+interval '1 month')::date;
 select count(*)::bigint into v_outgoing_checked
 from public.platform_referral_payout_claims_v1_263 x
 where x.paid_on>=v_month and x.paid_on<(v_month+interval '1 month')::date
  and exists(select 1 from public.platform_referral_provider_observations_v1_265 o
   where o.claim_id=x.claim_id);

 return jsonb_build_object(
  'source','admin_owner_multi_psp_hub_v1_267',
  'month',v_month,'timezone','America/Sao_Paulo',
  'merchantProviders',v_merchant,
  'outgoingProviders',v_outgoing,
  'merchantCatalogProviders',jsonb_array_length(v_merchant),
  'merchantEvidenceRecords',v_merchant_evidence,
  'merchantProviderVerifiedOrders',v_merchant_orders,
  'outgoingProviderCategories',4,
  'outgoingClaims',v_outgoing_claims,
  'outgoingClaimsQueried',v_outgoing_checked,
  'providerCatalogIsRuntimeVerification',false,
  'merchantReceiptsProvePlatformPayouts',false,
  'merchantAndPlatformFundsNettingAllowed',false,
  'bankSettlementVerified',false,
  'recipientVerified',false,
  'externalPaidBenefitsCents',null,
  'noTransfers',true,'noIdentityCollection',true,
  'newBenefitsEnabled',false,'readOnly',true
 );
end;$fn$;
revoke all on function platform_multi_psp_private_v1_267.report(uuid,date)
 from public,anon,authenticated,service_role;
grant execute on function platform_multi_psp_private_v1_267.report(uuid,date)
 to service_role;
create or replace function public.admin_owner_multi_psp_hub_v1_267(
 p_actor uuid,p_month date default null
) returns jsonb language sql stable security invoker
set search_path=pg_catalog as $wrapper$
 select platform_multi_psp_private_v1_267.report($1,$2)
$wrapper$;
revoke all on function public.admin_owner_multi_psp_hub_v1_267(uuid,date)
 from public,anon,authenticated,service_role;
grant execute on function public.admin_owner_multi_psp_hub_v1_267(uuid,date)
 to service_role;
do $acl$begin
 if has_function_privilege('anon','public.admin_owner_multi_psp_hub_v1_267(uuid,date)','EXECUTE')
  or has_function_privilege('authenticated','public.admin_owner_multi_psp_hub_v1_267(uuid,date)','EXECUTE')
  or not has_function_privilege('service_role','public.admin_owner_multi_psp_hub_v1_267(uuid,date)','EXECUTE')
 then raise exception 'MULTI_PSP_V1_267_ACL_DRIFT' using errcode='42501';end if;
end$acl$;