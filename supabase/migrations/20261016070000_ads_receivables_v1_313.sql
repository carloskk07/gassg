-- TAMÃO V1.313 — separate TAMÃO Ads receivables, never merchant fee credits.
-- Issuing an internal payment statement is a founder-only command; no PSP requests or paid status exist.
create table public.platform_ads_receivables_v1_313(
  merchant_id uuid primary key references public.merchants(id),
  document_sha256 text not null check(document_sha256 ~ '^[a-f0-9]{64}$'),
  instrument_version integer not null check(instrument_version>=3),
  amount_cents integer not null check(amount_cents between 1000 and 5000000),
  currency text not null default 'BRL' check(currency='BRL'),
  due_days integer not null check(due_days between 1 and 30),
  status text not null check(status in ('draft','issued','canceled')),
  version integer not null check(version>0),
  due_date date,issued_at timestamptz,canceled_at timestamptz,
  updated_by uuid not null,updated_at timestamptz not null default clock_timestamp(),
  check ((status='draft' and issued_at is null and due_date is null and canceled_at is null)
    or (status='issued' and issued_at is not null and due_date is not null and canceled_at is null)
    or (status='canceled' and issued_at is not null and due_date is not null and canceled_at is not null))
);
alter table public.platform_ads_receivables_v1_313 enable row level security;
revoke all on public.platform_ads_receivables_v1_313 from public,anon,authenticated;
grant select,insert,update on public.platform_ads_receivables_v1_313 to service_role;

create table public.platform_ads_receivable_requests_v1_313(
 request_id uuid primary key,merchant_id uuid not null references public.merchants(id),
 actor_user_id uuid not null,signature jsonb not null,response jsonb not null,
 created_at timestamptz not null default clock_timestamp()
);
alter table public.platform_ads_receivable_requests_v1_313 enable row level security;
revoke all on public.platform_ads_receivable_requests_v1_313 from public,anon,authenticated;
grant select,insert on public.platform_ads_receivable_requests_v1_313 to service_role;

-- Customer-reported payment references are NOT financial confirmation.
create table public.platform_ads_payment_reports_v1_313(
 request_id uuid primary key,merchant_id uuid not null references public.merchants(id),
 actor_user_id uuid not null,receivable_version integer not null check(receivable_version>0),
 claimed_reference text not null check(char_length(claimed_reference) between 8 and 120),
 created_at timestamptz not null default clock_timestamp(),
 verification_status text not null default 'unverified' check(verification_status='unverified')
);
create index platform_ads_payment_reports_merchant_v1_313
 on public.platform_ads_payment_reports_v1_313(merchant_id,created_at desc);
alter table public.platform_ads_payment_reports_v1_313 enable row level security;
revoke all on public.platform_ads_payment_reports_v1_313 from public,anon,authenticated;
grant select,insert on public.platform_ads_payment_reports_v1_313 to service_role;

create or replace function public.admin_ads_receivables_read_v1_313(p_actor uuid)
returns jsonb language plpgsql stable security definer set search_path to 'pg_catalog' as $f$
declare v_rows jsonb;v_tot bigint;v_issued bigint;v_reports bigint;
begin
 if not exists(select 1 from public.platform_admins a where a.user_id=p_actor and a.active
   and a.admin_role in ('superadmin','operations','readonly'))
 then raise exception 'ADS_RECEIVABLE_ADMIN_DENIED' using errcode='42501';end if;
 select count(*),count(*) filter(where status='issued') into v_tot,v_issued
 from public.platform_ads_receivables_v1_313;
 select count(*) into v_reports from public.platform_ads_payment_reports_v1_313;
 select coalesce(jsonb_agg(jsonb_build_object(
   'merchantId',i.merchant_id,'merchantName',left(m.name,120),
   'instrumentStatus',i.status,'sha256',i.document_sha256,
   'instrumentVersion',i.version,'amountCents',i.document_snapshot->'priceCents',
   'dueDays',i.document_snapshot->'dueDays',
   'receivable',case when r.merchant_id is null then null else jsonb_build_object(
      'status',r.status,'version',r.version,'amountCents',r.amount_cents,
      'dueDays',r.due_days,'currency',r.currency,
      'dueDate',r.due_date,'issuedAt',r.issued_at,'canceledAt',r.canceled_at) end,
   'paymentReportsUnverified',coalesce(pr.report_count,0)
 ) order by i.issued_at desc,i.merchant_id),'[]'::jsonb) into v_rows
 from (select * from public.platform_ads_instruments_v1_312
       where status='bilateral_accepted' order by issued_at desc limit 50) i
 join public.merchants m on m.id=i.merchant_id
 left join public.platform_ads_receivables_v1_313 r on r.merchant_id=i.merchant_id
 left join (select merchant_id,count(*) report_count from public.platform_ads_payment_reports_v1_313 group by merchant_id) pr
 on pr.merchant_id=i.merchant_id;
 return jsonb_build_object('source','admin_ads_receivables_v1_313','readOnly',true,
  'totalReceivables',v_tot,'issuedReceivables',v_issued,'unverifiedReports',v_reports,
  'rows',v_rows,'verifiedPayments',0,'collectedRevenueCents',0,
  'pspChargeCreated',false,'adsLive',false,'merchantBillingSeparate',true);
end;
$f$;
revoke all on function public.admin_ads_receivables_read_v1_313(uuid) from public,anon,authenticated;
grant execute on function public.admin_ads_receivables_read_v1_313(uuid) to service_role;

create or replace function public.admin_ads_receivable_action_v1_313(
 p_actor uuid,p_merchant uuid,p_operation text,p_instrument_sha256 text,
 p_expected_version integer,p_reason text,p_request uuid
) returns jsonb language plpgsql security definer set search_path to 'pg_catalog' as $f$
declare v_instrument public.platform_ads_instruments_v1_312%rowtype;
 v_receivable public.platform_ads_receivables_v1_313%rowtype;
 v_prior record;v_sig jsonb;v_status text;v_version integer;
 v_due date;v_response jsonb;
begin
 if not exists(select 1 from public.platform_admins a where a.user_id=p_actor and a.active
   and a.admin_role='superadmin')
 then raise exception 'ADS_RECEIVABLE_FOUNDER_REQUIRED' using errcode='42501';end if;
 if p_merchant is null or p_request is null or p_operation not in ('prepare','issue','cancel')
 or p_instrument_sha256 is null or p_instrument_sha256 !~ '^[a-f0-9]{64}$'
 or p_expected_version is null or p_expected_version<0
 or p_reason is null or char_length(btrim(p_reason)) not between 12 and 240
 then raise exception 'ADS_RECEIVABLE_INVALID_ACTION' using errcode='22023';end if;
 v_sig:=jsonb_build_object('actor',p_actor,'merchant',p_merchant,'action',p_operation,
 'instrumentSha256',p_instrument_sha256,'expectedVersion',p_expected_version,'reason',btrim(p_reason));
 select signature,response into v_prior from public.platform_ads_receivable_requests_v1_313 where request_id=p_request;
 if found then
  if v_prior.signature is distinct from v_sig then raise exception 'ADS_RECEIVABLE_REQUEST_REUSE' using errcode='23505';end if;
  return v_prior.response||jsonb_build_object('replayed',true);
 end if;
 select * into v_instrument from public.platform_ads_instruments_v1_312
 where merchant_id=p_merchant and status='bilateral_accepted' and document_sha256=p_instrument_sha256 for update;
 if not found or v_instrument.founder_accepted_at is null or v_instrument.merchant_accepted_at is null
   or v_instrument.version<3
 then raise exception 'ADS_RECEIVABLE_BILATERAL_ACCEPTANCE_REQUIRED' using errcode='40001';end if;
 if v_instrument.document_sha256 is distinct from encode(extensions.digest(
   pg_catalog.convert_to(v_instrument.document_snapshot::text,'UTF8'),'sha256'),'hex')
 then raise exception 'ADS_RECEIVABLE_DOCUMENT_HASH_MISMATCH' using errcode='40001';end if;
 select * into v_receivable from public.platform_ads_receivables_v1_313
 where merchant_id=p_merchant for update;
 if v_receivable.merchant_id is null then
   if p_operation<>'prepare' or p_expected_version<>0 then raise exception 'ADS_RECEIVABLE_NOT_PREPARED' using errcode='40001';end if;
 else
   if v_receivable.version<>p_expected_version or v_receivable.document_sha256<>v_instrument.document_sha256
   then raise exception 'ADS_RECEIVABLE_VERSION_CONFLICT' using errcode='40001';end if;
 end if;
 if p_operation='prepare' then
   if v_receivable.merchant_id is not null then raise exception 'ADS_RECEIVABLE_ALREADY_PREPARED' using errcode='40001';end if;
   v_version:=1;v_status:='draft';
   insert into public.platform_ads_receivables_v1_313(
    merchant_id,document_sha256,instrument_version,amount_cents,due_days,status,version,updated_by)
   values(p_merchant,v_instrument.document_sha256,v_instrument.version,
    (v_instrument.document_snapshot->>'priceCents')::integer,
    (v_instrument.document_snapshot->>'dueDays')::integer,'draft',1,p_actor);
 elsif p_operation='issue' then
   if v_receivable.status<>'draft' then raise exception 'ADS_RECEIVABLE_NOT_DRAFT' using errcode='40001';end if;
   v_version:=v_receivable.version+1;v_status:='issued';
   v_due:=(clock_timestamp() at time zone 'America/Sao_Paulo')::date+v_receivable.due_days;
   update public.platform_ads_receivables_v1_313
   set status='issued',issued_at=clock_timestamp(),due_date=v_due,
     version=v_version,updated_by=p_actor,updated_at=clock_timestamp()
   where merchant_id=p_merchant;
 else
   if v_receivable.status<>'issued' then raise exception 'ADS_RECEIVABLE_NOT_ISSUED' using errcode='40001';end if;
   v_version:=v_receivable.version+1;v_status:='canceled';
   update public.platform_ads_receivables_v1_313
   set status='canceled',canceled_at=clock_timestamp(),
     version=v_version,updated_by=p_actor,updated_at=clock_timestamp()
   where merchant_id=p_merchant;
 end if;
 v_response:=jsonb_build_object('source','admin_ads_receivable_action_v1_313',
    'merchantId',p_merchant,'status',v_status,'version',v_version,
    'recorded',true,'replayed',false,'verifiedPaid',false,'pspChargeCreated',false,
    'adsLive',false,'merchantBillingSeparate',true);
 insert into public.platform_ads_receivable_requests_v1_313(
  request_id,merchant_id,actor_user_id,signature,response)
 values(p_request,p_merchant,p_actor,v_sig,v_response);
 insert into public.platform_admin_audit(actor_user_id,action,target_type,target_id,metadata)
 values(p_actor,'ads-receivable-'||p_operation,'merchant',p_merchant::text,
  jsonb_build_object('requestId',p_request,'documentSha256',p_instrument_sha256,
    'receivableVersion',v_version,'status',v_status,'reason',btrim(p_reason)));
 return v_response;
end;
$f$;
revoke all on function public.admin_ads_receivable_action_v1_313(uuid,uuid,text,text,integer,text,uuid) from public,anon,authenticated;
grant execute on function public.admin_ads_receivable_action_v1_313(uuid,uuid,text,text,integer,text,uuid) to service_role;

create or replace function public.merchant_ads_receivable_v1_313(
 p_actor uuid,p_merchant uuid,p_operation text,p_version integer default null,
 p_reference text default null,p_request uuid default null
) returns jsonb language plpgsql security definer set search_path to 'pg_catalog' as $f$
declare v_role text;v_r public.platform_ads_receivables_v1_313%rowtype;
 v_response jsonb;v_previous public.platform_ads_payment_reports_v1_313%rowtype;
begin
 select mm.member_role into v_role from public.merchant_members mm
 where mm.merchant_id=p_merchant and mm.user_id=p_actor and mm.active
 and mm.member_role in ('owner','manager') limit 1;
 if v_role is null then raise exception 'ADS_RECEIVABLE_MERCHANT_DENIED' using errcode='42501';end if;
 if p_operation not in ('view','report') then raise exception 'ADS_RECEIVABLE_OPERATION_INVALID' using errcode='22023';end if;
 if p_operation='report' and (v_role<>'owner' or p_request is null
 or p_version is null or p_version<1 or p_reference is null
 or char_length(btrim(p_reference)) not between 8 and 120
 or btrim(p_reference) !~ '^[A-Za-z0-9][A-Za-z0-9 _./:-]{7,119}$')
 then raise exception 'ADS_RECEIVABLE_OWNER_REPORT_REQUIRED' using errcode='42501';end if;
 if p_operation='report' then
   select * into v_previous from public.platform_ads_payment_reports_v1_313 where request_id=p_request;
   if found then
     if v_previous.actor_user_id<>p_actor or v_previous.merchant_id<>p_merchant
      or v_previous.receivable_version<>p_version or v_previous.claimed_reference<>btrim(p_reference)
     then raise exception 'ADS_RECEIVABLE_REPORT_REUSE' using errcode='23505';end if;
     return jsonb_build_object('source','merchant_ads_receivable_v1_313',
      'merchantId',p_merchant,'reported',true,'replayed',true,
      'paymentVerified',false,'adsLive',false,'pspChargeCreated',false);
   end if;
 end if;
 select * into v_r from public.platform_ads_receivables_v1_313 where merchant_id=p_merchant for update;
 if p_operation='view' then
   return jsonb_build_object('source','merchant_ads_receivable_v1_313',
    'merchantId',p_merchant,'readOnly',true,'paymentVerified',false,
    'adsLive',false,'pspChargeCreated',false,
    'statement',case when v_r.status in ('issued','canceled') then jsonb_build_object(
       'amountCents',v_r.amount_cents,'currency',v_r.currency,'status',v_r.status,
       'version',v_r.version,'dueDate',v_r.due_date,'issuedAt',v_r.issued_at,
       'documentSha256',v_r.document_sha256,
       'unverifiedReports',(select count(*) from public.platform_ads_payment_reports_v1_313 p
         where p.merchant_id=p_merchant)) else null end);
 end if;
 if v_r.merchant_id is null or v_r.status<>'issued' or v_r.version<>p_version
 then raise exception 'ADS_RECEIVABLE_REPORT_NOT_AVAILABLE' using errcode='40001';end if;
 insert into public.platform_ads_payment_reports_v1_313(
   request_id,merchant_id,actor_user_id,receivable_version,claimed_reference)
 values(p_request,p_merchant,p_actor,p_version,btrim(p_reference));
 insert into public.platform_admin_audit(actor_user_id,action,target_type,target_id,metadata)
 values(p_actor,'ads-payment-reference-reported','merchant',p_merchant::text,
   jsonb_build_object('requestId',p_request,'version',p_version,'unverified',true));
 return jsonb_build_object('source','merchant_ads_receivable_v1_313',
   'merchantId',p_merchant,'reported',true,'replayed',false,
   'paymentVerified',false,'adsLive',false,'pspChargeCreated',false);
end;
$f$;
revoke all on function public.merchant_ads_receivable_v1_313(uuid,uuid,text,integer,text,uuid) from public,anon,authenticated;
grant execute on function public.merchant_ads_receivable_v1_313(uuid,uuid,text,integer,text,uuid) to service_role;
