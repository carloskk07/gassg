-- TAMÃO V1.312 — authenticated electronic bilateral acceptance, not ICP-Brasil certification.
-- This is a separate, immutable evidence layer. Payment and public Ads delivery stay disabled.
create table public.platform_ads_instruments_v1_312(
 merchant_id uuid primary key references public.merchants(id),
 dossier_version integer not null check(dossier_version>0),
 document_snapshot jsonb not null,
 document_sha256 text not null check(document_sha256 ~ '^[a-f0-9]{64}$'),
 status text not null check(status in ('offered','merchant_accepted','bilateral_accepted')),
 version integer not null default 1 check(version>0),
 issued_by uuid not null,issued_at timestamptz not null default clock_timestamp(),
 merchant_accepted_by uuid,merchant_accepted_at timestamptz,
 founder_accepted_by uuid,founder_accepted_at timestamptz,
 updated_at timestamptz not null default clock_timestamp()
);
alter table public.platform_ads_instruments_v1_312 enable row level security;
revoke all on public.platform_ads_instruments_v1_312 from public,anon,authenticated;
grant select,insert,update on public.platform_ads_instruments_v1_312 to service_role;

create table public.platform_ads_acceptance_evidence_v1_312(
 request_id uuid primary key,
 merchant_id uuid not null references public.merchants(id),
 actor_user_id uuid not null,
 operation text not null check(operation in ('issue','merchant_accept','founder_accept')),
 evidence_sha256 text not null check(evidence_sha256 ~ '^[a-f0-9]{64}$'),
 request_signature jsonb not null,response jsonb not null,
 occurred_at timestamptz not null default clock_timestamp()
);
create index platform_ads_acceptance_evidence_merchant_v1_312 on public.platform_ads_acceptance_evidence_v1_312(merchant_id,occurred_at desc);
alter table public.platform_ads_acceptance_evidence_v1_312 enable row level security;
revoke all on public.platform_ads_acceptance_evidence_v1_312 from public,anon,authenticated;
grant select,insert on public.platform_ads_acceptance_evidence_v1_312 to service_role;

create or replace function public.admin_ads_instruments_read_v1_312(p_actor uuid)
returns jsonb language plpgsql stable security definer set search_path to 'pg_catalog'
as $body$
declare v_rows jsonb;v_total bigint;
begin
 if not exists(select 1 from public.platform_admins a where a.user_id=p_actor and a.active
   and a.admin_role in ('superadmin','operations','readonly'))
 then raise exception 'ADS_INSTRUMENT_ADMIN_DENIED' using errcode='42501';end if;
 select count(*) into v_total from public.platform_ads_instruments_v1_312;
 select coalesce(jsonb_agg(jsonb_build_object(
   'merchantId',i.merchant_id,'merchantName',left(m.name,120),
   'document',i.document_snapshot,'sha256',i.document_sha256,
   'dossierVersion',i.dossier_version,'status',i.status,'version',i.version,
   'issuedAt',i.issued_at,'merchantAcceptedAt',i.merchant_accepted_at,
   'founderAcceptedAt',i.founder_accepted_at
 ) order by i.issued_at desc,i.merchant_id),'[]'::jsonb) into v_rows
 from (select * from public.platform_ads_instruments_v1_312 order by issued_at desc limit 50) i
 join public.merchants m on m.id=i.merchant_id;
 return jsonb_build_object('source','admin_ads_instruments_v1_312','readOnly',true,
 'totalInstruments',v_total,'rows',v_rows,'noCharge',true,'adsLive',false,
 'paymentRequestsCreated',0,'deliveryVerified',false,'notIcpCertified',true);
end;
$body$;
revoke all on function public.admin_ads_instruments_read_v1_312(uuid) from public,anon,authenticated;
grant execute on function public.admin_ads_instruments_read_v1_312(uuid) to service_role;

create or replace function public.admin_ads_instrument_action_v1_312(
 p_actor uuid,p_merchant uuid,p_operation text,p_expected_version integer,
 p_platform_legal_name text,p_platform_cnpj text,p_document_sha256 text,p_request uuid
) returns jsonb language plpgsql security definer set search_path to 'pg_catalog'
as $body$
declare v_d public.platform_ads_contract_dossiers_v1_311%rowtype;
 v_i public.platform_ads_instruments_v1_312%rowtype;
 v_m public.merchants%rowtype;
 v_sig jsonb;v_old record;v_document jsonb;v_sha text;v_version integer;v_status text;
 v_response jsonb;
begin
 if not exists(select 1 from public.platform_admins a where a.user_id=p_actor and a.active and a.admin_role='superadmin')
 then raise exception 'ADS_INSTRUMENT_FOUNDER_REQUIRED' using errcode='42501';end if;
 if p_merchant is null or p_request is null or p_operation not in ('issue','founder_accept')
 or p_expected_version is null or p_expected_version<0
 then raise exception 'ADS_INSTRUMENT_INVALID' using errcode='22023';end if;
 if p_operation='issue' and (p_expected_version<>0 or p_platform_legal_name is null
   or char_length(btrim(p_platform_legal_name)) not between 5 and 160
   or p_platform_cnpj is null or p_platform_cnpj !~ '^[0-9]{14}$')
 then raise exception 'ADS_INSTRUMENT_ISSUER_IDENTITY_REQUIRED' using errcode='22023';end if;
 v_sig:=jsonb_build_object('actor',p_actor,'merchant',p_merchant,'operation',p_operation,
   'expectedVersion',p_expected_version,'platformName',p_platform_legal_name,
   'platformCnpj',p_platform_cnpj,'sha256',p_document_sha256);
 select request_signature,response into v_old from public.platform_ads_acceptance_evidence_v1_312 where request_id=p_request;
 if found then
   if v_old.request_signature is distinct from v_sig then raise exception 'ADS_INSTRUMENT_REQUEST_REUSE' using errcode='23505';end if;
   return v_old.response||jsonb_build_object('replayed',true);
 end if;
 select * into v_i from public.platform_ads_instruments_v1_312 where merchant_id=p_merchant for update;
 if p_operation='issue' then
   if v_i.merchant_id is not null then raise exception 'ADS_INSTRUMENT_ALREADY_ISSUED' using errcode='40001';end if;
   select * into v_d from public.platform_ads_contract_dossiers_v1_311
   where merchant_id=p_merchant and status='reviewed' for update;
   if not found then raise exception 'ADS_INSTRUMENT_REVIEW_MISSING' using errcode='40001';end if;
   select * into v_m from public.merchants where id=p_merchant;
   if v_m.cnpj is null or regexp_replace(v_m.cnpj,'[^0-9]','','g') !~ '^[0-9]{14}$'
     or char_length(btrim(v_m.name))<4
   then raise exception 'ADS_INSTRUMENT_MERCHANT_IDENTITY_REQUIRED' using errcode='40001';end if;
   perform 1 from public.platform_ads_offers_v1_310 o where o.merchant_id=p_merchant
     and o.status='interested' and o.version=v_d.offer_version and o.price_cents=v_d.price_cents
     and o.duration_days=v_d.duration_days for update;
   if not found then raise exception 'ADS_INSTRUMENT_OFFER_CHANGED' using errcode='40001';end if;
   perform 1 from public.merchant_ads_campaigns_v1_233 c
   where c.merchant_id=p_merchant and c.status='approved_creative' and c.ads_live=false and c.no_charge=true for update;
   if not found then raise exception 'ADS_INSTRUMENT_CREATIVE_REVOKED' using errcode='40001';end if;
   v_document:=jsonb_build_object(
     'schema','ads-electronic-instrument-v1.312','merchantId',p_merchant,
     'platformLegalName',btrim(p_platform_legal_name),'platformCnpj',p_platform_cnpj,
     'merchantLegalName',btrim(v_m.name),'merchantCnpj',regexp_replace(v_m.cnpj,'[^0-9]','','g'),
     'dossierVersion',v_d.version,'offerVersion',v_d.offer_version,
     'priceCents',v_d.price_cents,'durationDays',v_d.duration_days,
     'serviceScope',v_d.service_scope,'cancellationTerms',v_d.cancellation_terms,
     'dueDays',v_d.due_days,
     'executionCondition','Exibição depende de publicação administrativa e prova técnica independente. Pagamento exige cobrança específica e confirmação do PSP; este aceite isolado não gera débito.',
     'signatureMethod','Aceite por conta autenticada com evidência de usuário, hora UTC e hash SHA-256; não utiliza certificado ICP-Brasil.',
     'jurisdiction','Brasil');
   v_sha:=encode(extensions.digest(pg_catalog.convert_to(v_document::text,'UTF8'),'sha256'),'hex');
   insert into public.platform_ads_instruments_v1_312(
      merchant_id,dossier_version,document_snapshot,document_sha256,status,issued_by
   ) values(p_merchant,v_d.version,v_document,v_sha,'offered',p_actor);
   v_version:=1;v_status:='offered';
 else
   if v_i.merchant_id is null or v_i.status<>'merchant_accepted'
      or v_i.version<>p_expected_version or p_document_sha256<>v_i.document_sha256
   then raise exception 'ADS_INSTRUMENT_COUNTERSIGN_BLOCKED' using errcode='40001';end if;
   if v_i.document_sha256<>encode(extensions.digest(pg_catalog.convert_to(v_i.document_snapshot::text,'UTF8'),'sha256'),'hex')
   then raise exception 'ADS_INSTRUMENT_HASH_MISMATCH' using errcode='40001';end if;
   update public.platform_ads_instruments_v1_312 set status='bilateral_accepted',
     version=version+1,founder_accepted_by=p_actor,founder_accepted_at=clock_timestamp(),
     updated_at=clock_timestamp() where merchant_id=p_merchant returning version into v_version;
   v_sha:=v_i.document_sha256;v_status:='bilateral_accepted';
 end if;
 v_response:=jsonb_build_object('source','admin_ads_instrument_action_v1_312',
    'merchantId',p_merchant,'status',v_status,'version',v_version,'sha256',v_sha,
    'recorded',true,'replayed',false,'noCharge',true,'adsLive',false,
    'paymentRequestCreated',false,'notIcpCertified',true);
 insert into public.platform_ads_acceptance_evidence_v1_312(
    request_id,merchant_id,actor_user_id,operation,evidence_sha256,request_signature,response)
 values(p_request,p_merchant,p_actor,p_operation,v_sha,v_sig,v_response);
 insert into public.platform_admin_audit(actor_user_id,action,target_type,target_id,metadata)
 values(p_actor,'ads-instrument-'||p_operation,'merchant',p_merchant::text,
  jsonb_build_object('requestId',p_request,'documentSha256',v_sha,'status',v_status));
 return v_response;
end;
$body$;
revoke all on function public.admin_ads_instrument_action_v1_312(uuid,uuid,text,integer,text,text,text,uuid)
 from public,anon,authenticated;
grant execute on function public.admin_ads_instrument_action_v1_312(uuid,uuid,text,integer,text,text,text,uuid)
 to service_role;

create or replace function public.merchant_ads_instrument_v1_312(
 p_actor uuid,p_merchant uuid,p_action text,p_expected_version integer default null,
 p_document_sha256 text default null,p_consent boolean default false,p_request uuid default null
) returns jsonb language plpgsql security definer set search_path to 'pg_catalog'
as $body$
declare v_role text;v_i public.platform_ads_instruments_v1_312%rowtype;
 v_sig jsonb;v_old record;v_status text;v_version integer;v_response jsonb;
begin
 select mm.member_role into v_role from public.merchant_members mm
 where mm.merchant_id=p_merchant and mm.user_id=p_actor and mm.active
  and mm.member_role in ('owner','manager') limit 1;
 if v_role is null then raise exception 'ADS_INSTRUMENT_MERCHANT_DENIED' using errcode='42501';end if;
 if p_action not in ('view','accept') then raise exception 'ADS_INSTRUMENT_ACTION_INVALID' using errcode='22023';end if;
 if p_action='accept' and (v_role<>'owner' or p_consent is distinct from true
   or p_expected_version is null or p_expected_version<1 or p_request is null
   or p_document_sha256 is null or p_document_sha256 !~ '^[a-f0-9]{64}$')
 then raise exception 'ADS_INSTRUMENT_OWNER_CONFIRMATION_REQUIRED' using errcode='42501';end if;
 if p_action='accept' then
  v_sig:=jsonb_build_object('actor',p_actor,'merchant',p_merchant,'action','accept',
    'expectedVersion',p_expected_version,'sha256',p_document_sha256,'consent',p_consent);
  select request_signature,response into v_old from public.platform_ads_acceptance_evidence_v1_312 where request_id=p_request;
  if found then
   if v_old.request_signature is distinct from v_sig then raise exception 'ADS_INSTRUMENT_REQUEST_REUSE' using errcode='23505';end if;
   return v_old.response||jsonb_build_object('replayed',true);
  end if;
 end if;
 select * into v_i from public.platform_ads_instruments_v1_312 where merchant_id=p_merchant for update;
 if p_action='view' then
  return jsonb_build_object('source','merchant_ads_instrument_v1_312','merchantId',p_merchant,
    'readOnly',true,'noCharge',true,'adsLive',false,'paymentRequestCreated',false,
    'notIcpCertified',true,
    'instrument',case when v_i.merchant_id is null then null else jsonb_build_object(
      'document',v_i.document_snapshot,'sha256',v_i.document_sha256,'status',v_i.status,
      'version',v_i.version,'issuedAt',v_i.issued_at,
      'merchantAcceptedAt',v_i.merchant_accepted_at,'founderAcceptedAt',v_i.founder_accepted_at) end);
 end if;
 if v_i.merchant_id is null or v_i.status<>'offered' or v_i.version<>p_expected_version
   or v_i.document_sha256<>p_document_sha256
 then raise exception 'ADS_INSTRUMENT_STALE_OR_UNAVAILABLE' using errcode='40001';end if;
 if v_i.document_sha256<>encode(extensions.digest(pg_catalog.convert_to(v_i.document_snapshot::text,'UTF8'),'sha256'),'hex')
 then raise exception 'ADS_INSTRUMENT_HASH_MISMATCH' using errcode='40001';end if;
 -- Do not accept a document if creative has been withdrawn/revised.
 perform 1 from public.platform_ads_contract_dossiers_v1_311 d
 where d.merchant_id=p_merchant and d.version=v_i.dossier_version and d.status='reviewed';
 if not found then raise exception 'ADS_INSTRUMENT_DOSSIER_CHANGED' using errcode='40001';end if;
 update public.platform_ads_instruments_v1_312 set status='merchant_accepted',
   version=version+1,merchant_accepted_by=p_actor,merchant_accepted_at=clock_timestamp(),
   updated_at=clock_timestamp() where merchant_id=p_merchant returning version into v_version;
 v_response:=jsonb_build_object('source','merchant_ads_instrument_v1_312','merchantId',p_merchant,
   'status','merchant_accepted','version',v_version,'sha256',v_i.document_sha256,
   'recorded',true,'replayed',false,'noCharge',true,'adsLive',false,
   'paymentRequestCreated',false,'notIcpCertified',true);
 insert into public.platform_ads_acceptance_evidence_v1_312(
    request_id,merchant_id,actor_user_id,operation,evidence_sha256,request_signature,response)
 values(p_request,p_merchant,p_actor,'merchant_accept',v_i.document_sha256,v_sig,v_response);
 insert into public.platform_admin_audit(actor_user_id,action,target_type,target_id,metadata)
 values(p_actor,'ads-instrument-merchant-accept','merchant',p_merchant::text,
   jsonb_build_object('requestId',p_request,'documentSha256',v_i.document_sha256));
 return v_response;
end;
$body$;
revoke all on function public.merchant_ads_instrument_v1_312(uuid,uuid,text,integer,text,boolean,uuid)
 from public,anon,authenticated;
grant execute on function public.merchant_ads_instrument_v1_312(uuid,uuid,text,integer,text,boolean,uuid)
 to service_role;
