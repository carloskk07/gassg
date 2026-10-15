-- TAMÃO V1.314.1 — PSP settlement proof hardening; preserves original V1.314 migration history.
-- Fail closed for missing/null provider attributes, conservative partial refunds, immutable checkout identity.
create or replace function public.ads_psp_checkout_immutable_v1_314()
returns trigger language plpgsql set search_path to 'pg_catalog' as $guard$
begin
 if old.merchant_id is distinct from new.merchant_id
   or old.receivable_version is distinct from new.receivable_version
   or old.document_sha256 is distinct from new.document_sha256
   or old.amount_cents is distinct from new.amount_cents
   or old.external_reference is distinct from new.external_reference
   or old.provider is distinct from new.provider
   or old.reserved_by is distinct from new.reserved_by
   or old.reserved_at is distinct from new.reserved_at
   or (old.preference_id is not null and old.preference_id is distinct from new.preference_id)
   or (old.collector_id is not null and old.collector_id is distinct from new.collector_id)
   or (old.payment_id is not null and old.payment_id is distinct from new.payment_id)
 then raise exception 'ADS_PSP_CHECKOUT_IDENTITY_IMMUTABLE' using errcode='42501';end if;
 return new;
end;
$guard$;
create trigger ads_psp_checkout_immutable_v1_314_before_update
 before update on public.platform_ads_psp_checkouts_v1_314 for each row
 execute function public.ads_psp_checkout_immutable_v1_314();

create or replace function public.admin_ads_psp_action_v1_314(
 p_actor uuid,p_merchant uuid,p_operation text,p_expected_version integer,
 p_preference_id text,p_checkout_url text,p_collector_id text,
 p_payment_data jsonb,p_request uuid
) returns jsonb language plpgsql security definer set search_path to 'pg_catalog' as $f$
declare v_r public.platform_ads_receivables_v1_313%rowtype;
 v_i public.platform_ads_instruments_v1_312%rowtype;
 v_c public.platform_ads_psp_checkouts_v1_314%rowtype;
 v_sig jsonb;v_previous record;v_reference text;v_version integer;v_status text;
 v_payment_id text;v_payment_status text;v_detail text;v_paid_cents integer;
 v_response jsonb;v_now timestamptz;
begin
 if not exists(select 1 from public.platform_admins a where a.user_id=p_actor and a.active
   and a.admin_role='superadmin')
 then raise exception 'ADS_PSP_FOUNDER_REQUIRED' using errcode='42501';end if;
 if p_merchant is null or p_request is null or p_expected_version is null
 or p_expected_version<0 or p_operation not in ('reserve','attach','verify','reverse')
 then raise exception 'ADS_PSP_ACTION_INVALID' using errcode='22023';end if;
 v_sig:=jsonb_build_object('actor',p_actor,'merchant',p_merchant,'operation',p_operation,
  'expectedVersion',p_expected_version,'preferenceId',p_preference_id,
  'checkoutUrl',p_checkout_url,'collectorId',p_collector_id,'payment',p_payment_data);
 select request_signature,response into v_previous
 from public.platform_ads_psp_events_v1_314 where request_id=p_request;
 if found then
  if v_previous.request_signature is distinct from v_sig
  then raise exception 'ADS_PSP_REQUEST_REUSE' using errcode='23505';end if;
  return v_previous.response||jsonb_build_object('replayed',true);
 end if;
 select * into v_r from public.platform_ads_receivables_v1_313
 where merchant_id=p_merchant for update;
 select * into v_i from public.platform_ads_instruments_v1_312
 where merchant_id=p_merchant for update;
 if v_r.merchant_id is null or v_r.status not in ('issued','canceled')
  or v_i.merchant_id is null or v_i.status<>'bilateral_accepted'
  or v_r.document_sha256<>v_i.document_sha256
  or v_r.amount_cents<>(v_i.document_snapshot->>'priceCents')::integer
  or v_i.document_sha256<>encode(extensions.digest(
    pg_catalog.convert_to(v_i.document_snapshot::text,'UTF8'),'sha256'),'hex')
 then raise exception 'ADS_PSP_INSTRUMENT_OR_STATEMENT_INVALID' using errcode='40001';end if;
 select * into v_c from public.platform_ads_psp_checkouts_v1_314
 where merchant_id=p_merchant for update;
 if p_operation='reserve' then
  if v_c.merchant_id is not null or p_expected_version<>0 or v_r.status<>'issued' or
    v_r.due_date<(clock_timestamp() at time zone 'America/Sao_Paulo')::date
  then raise exception 'ADS_PSP_CANNOT_RESERVE' using errcode='40001';end if;
  v_reference:='tamao-ads-'||replace(p_merchant::text,'-','')||'-v'||v_r.version::text;
  insert into public.platform_ads_psp_checkouts_v1_314(
   merchant_id,receivable_version,document_sha256,amount_cents,
   external_reference,status,version,reserved_by)
  values(p_merchant,v_r.version,v_r.document_sha256,v_r.amount_cents,
   v_reference,'reserved',1,p_actor);
  v_version:=1;v_status:='reserved';
 else
  if v_c.merchant_id is null or v_c.version<>p_expected_version
  then raise exception 'ADS_PSP_CHECKOUT_VERSION_CONFLICT' using errcode='40001';end if;
  v_reference:=v_c.external_reference;
  if p_operation='attach' then
   if v_c.status<>'reserved' or v_r.status<>'issued' or v_r.version<>v_c.receivable_version or
      p_collector_id is null or p_collector_id !~ '^[0-9]{4,20}$' or
      p_preference_id is null or char_length(p_preference_id) not between 6 and 150 or
      p_preference_id !~ '^[a-zA-Z0-9_-]+$' or p_checkout_url is null or
      p_checkout_url !~ '^https://(www[.])?mercadopago[.]com([.]br)?/'
   then raise exception 'ADS_PSP_PROVIDER_PREFERENCE_INVALID' using errcode='22023';end if;
   update public.platform_ads_psp_checkouts_v1_314
   set status='checkout_ready',version=version+1,
    preference_id=p_preference_id,checkout_url=p_checkout_url,
    collector_id=p_collector_id,updated_at=clock_timestamp()
   where merchant_id=p_merchant returning version into v_version;
   v_status:='checkout_ready';
  else
   if v_c.status not in ('checkout_ready','payment_approved','payment_reversed') or
     v_c.collector_id is null or p_payment_data is null or
     jsonb_typeof(p_payment_data)<>'object' or
     p_payment_data->>'external_reference' is distinct from v_reference or
     p_payment_data->>'currency_id' is distinct from 'BRL' or
     p_payment_data->>'collector_id' is distinct from v_c.collector_id or
     p_payment_data->>'amount_cents' is distinct from v_c.amount_cents::text
   then raise exception 'ADS_PSP_PAYMENT_EVIDENCE_MISMATCH' using errcode='40001';end if;
   v_payment_id:=p_payment_data->>'payment_id';
   v_payment_status:=p_payment_data->>'status';
   v_detail:=p_payment_data->>'status_detail';
   if v_payment_id is null or v_payment_id !~ '^[0-9]{5,30}$' or
      coalesce(v_payment_status,'') not in ('approved','refunded','charged_back')
   then raise exception 'ADS_PSP_PAYMENT_NOT_SETTLED' using errcode='40001';end if;
   if v_c.payment_id is not null and v_c.payment_id<>v_payment_id
   then raise exception 'ADS_PSP_DIFFERENT_PAYMENT_ID' using errcode='40001';end if;
   if p_operation='verify' then
    if v_c.status<>'checkout_ready' or v_payment_status is distinct from 'approved'
     or v_detail is distinct from 'accredited'
    then raise exception 'ADS_PSP_APPROVAL_NOT_PROVEN' using errcode='40001';end if;
    v_status:='payment_approved';
    update public.platform_ads_psp_checkouts_v1_314 set
     status=v_status,version=version+1,payment_id=v_payment_id,
     provider_status=v_payment_status,provider_status_detail=v_detail,
     approved_at=clock_timestamp(),verified_at=clock_timestamp(),
     updated_at=clock_timestamp() where merchant_id=p_merchant
     returning version into v_version;
   else
    if v_c.status<>'payment_approved'
     or (v_payment_status not in ('refunded','charged_back') and
      not (v_payment_status='approved' and v_detail='partially_refunded'))
    then raise exception 'ADS_PSP_REVERSAL_NOT_PROVEN' using errcode='40001';end if;
    v_status:='payment_reversed';
    update public.platform_ads_psp_checkouts_v1_314 set
     status=v_status,version=version+1,provider_status=v_payment_status,
     provider_status_detail=v_detail,reversed_at=clock_timestamp(),
     verified_at=clock_timestamp(),updated_at=clock_timestamp()
     where merchant_id=p_merchant returning version into v_version;
   end if;
  end if;
 end if;
 v_response:=jsonb_build_object('source','admin_ads_psp_action_v1_314',
  'merchantId',p_merchant,'status',v_status,'version',v_version,
  'externalReference',v_reference,'recorded',true,'replayed',false,
  'providerApproved',v_status='payment_approved','adsLive',false,
  'merchantBillingSeparate',true);
 insert into public.platform_ads_psp_events_v1_314(
  request_id,merchant_id,actor_user_id,operation,request_signature,response)
 values(p_request,p_merchant,p_actor,p_operation,v_sig,v_response);
 insert into public.platform_admin_audit(actor_user_id,action,target_type,target_id,metadata)
 values(p_actor,'ads-psp-'||p_operation,'merchant',p_merchant::text,
   jsonb_build_object('requestId',p_request,'status',v_status,
    'externalReference',v_reference,'version',v_version,
    'providerStatus',v_payment_status));
 return v_response;
end;
$f$;

revoke all on function public.admin_ads_psp_action_v1_314(uuid,uuid,text,integer,text,text,text,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.admin_ads_psp_action_v1_314(uuid,uuid,text,integer,text,text,text,jsonb,uuid) to service_role;
