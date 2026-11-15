-- Independent NET evidence projection. No charge, entitlement, wallet or payout writer.
-- The existing coupon report worker/secret/schedule is reused; merchant sales
-- belong to the seller and are deliberately excluded from platform receipts.
create table public.platform_receipt_net_audit (
 kind text not null check(kind in ('billing','advertising','mobility')),
 resource_id uuid not null,
 gross_cents bigint not null check(gross_cents>0),
 net_cents bigint not null check(net_cents>0 and net_cents<=gross_cents),
 seller_id text not null check(seller_id ~ '^[1-9][0-9]{2,19}$'),
 provider_order_id text,
 provider_payment_id text not null check(provider_payment_id ~ '^[1-9][0-9]{2,19}$'),
 external_reference text not null check(length(external_reference) between 1 and 160),
 release_at timestamptz not null,
 report_sha256 text not null check(report_sha256 ~ '^[0-9a-f]{64}$'),
 evidence_reference text not null check(evidence_reference ~ '^mp-release:.+\.csv:[1-9][0-9]{2,19}$' and length(evidence_reference)<=240),
 recorded_at timestamptz not null default clock_timestamp(),
 primary key(kind,resource_id),
 unique(seller_id,provider_payment_id)
);
create table public.platform_receipt_net_observations (
 kind text not null check(kind in ('billing','advertising','mobility')),
 resource_id uuid not null,
 status text not null check(status in ('net_verified','awaiting_report','coverage_incomplete','provider_unavailable','requires_review','reversed')),
 reason text not null check(reason ~ '^[A-Za-z0-9_]{2,110}$'),
 last_checked_at timestamptz not null default clock_timestamp(),
 primary key(kind,resource_id)
);
alter table public.platform_receipt_net_audit enable row level security;
alter table public.platform_receipt_net_observations enable row level security;
revoke all on public.platform_receipt_net_audit, public.platform_receipt_net_observations from public,anon,authenticated,service_role;
grant select on public.platform_receipt_net_audit, public.platform_receipt_net_observations to service_role;

create function public.platform_receipt_net_audit_immutable()
returns trigger language plpgsql set search_path=pg_catalog as $fn$
begin raise exception 'PLATFORM_NET_EVIDENCE_IMMUTABLE' using errcode='42501';end $fn$;
revoke all on function public.platform_receipt_net_audit_immutable() from public,anon,authenticated;
create trigger platform_receipt_net_audit_immutable before update or delete on public.platform_receipt_net_audit
 for each row execute function public.platform_receipt_net_audit_immutable();

create function public.platform_receipt_net_sources()
returns table(kind text,resource_id uuid,business_status text,gross_cents bigint,
 external_reference text,provider_order_id text,provider_payment_id text,paid_at timestamptz,reversed boolean)
language sql stable security definer set search_path=pg_catalog as $fn$
 select 'billing'::text,c.id,c.status,c.amount_cents,c.correlation_id,c.provider_charge_id,
 c.provider_transaction_id,c.completed_at,
 exists(select 1 from public.merchant_billing_payment_refunds f where f.payment_request_id=c.payment_request_id
  and f.status<>'ignored_unrelated' and f.amount_cents>0)
 from public.merchant_billing_provider_charges c
 where c.provider='mercadopago' and c.currency='BRL' and c.status='completed' and c.completed_at is not null
 union all
 select 'advertising',a.campaign_id,a.status,a.amount_cents,a.external_reference,null::text,a.payment_id,
 a.approved_at,a.status<>'payment_approved' or a.reversed_at is not null
 from public.ads_independent_checkouts_v1_886 a where a.approved_at is not null and a.payment_id is not null
 union all
 select 'mobility',m.id,m.status,m.amount_cents,m.external_reference,m.provider_order_id,m.provider_payment_id,
 m.paid_at,m.status<>'paid'
 from public.mobility_fee_pix_invoices_v1_837 m where m.paid_at is not null
$fn$;
revoke all on function public.platform_receipt_net_sources() from public,anon,authenticated;
grant execute on function public.platform_receipt_net_sources() to service_role;

create function public.platform_receipt_net_pending(p_limit integer default 2,p_inspect boolean default false)
returns table(kind text,resource_id uuid,business_status text,gross_cents bigint,
 external_reference text,provider_order_id text,provider_payment_id text,paid_at timestamptz,reversed boolean)
language sql stable security definer set search_path=pg_catalog as $fn$
 select s.* from public.platform_receipt_net_sources() s
 left join public.platform_receipt_net_observations o using(kind,resource_id)
 where p_inspect or o.last_checked_at is null or
   o.last_checked_at<clock_timestamp()-case when o.status in ('net_verified','reversed') then interval '6 hours' else interval '30 minutes' end
 order by coalesce(o.last_checked_at,'epoch'::timestamptz),s.paid_at
 limit least(greatest(coalesce(p_limit,2),1),2)
$fn$;
revoke all on function public.platform_receipt_net_pending(integer,boolean) from public,anon,authenticated;
grant execute on function public.platform_receipt_net_pending(integer,boolean) to service_role;

create function public.platform_receipt_net_record(p_kind text,p_resource_id uuid,p_status text,p_reason text,
 p_evidence jsonb default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $fn$
declare s record; old public.platform_receipt_net_audit%rowtype; n bigint; released timestamptz;
begin
 if not exists(select 1 from public.clube_coupon_net_auto_config_v1_931 where id and enabled)
 then raise exception 'PLATFORM_NET_AUTO_DISABLED' using errcode='42501';end if;
 -- Serialize with the existing business row, without writing to that row.
 if p_kind='billing' then perform 1 from public.merchant_billing_provider_charges where id=p_resource_id for update;
 elsif p_kind='advertising' then perform 1 from public.ads_independent_checkouts_v1_886 where campaign_id=p_resource_id for update;
 elsif p_kind='mobility' then perform 1 from public.mobility_fee_pix_invoices_v1_837 where id=p_resource_id for update;
 else raise exception 'PLATFORM_NET_KIND_INVALID';end if;
 select * into s from public.platform_receipt_net_sources() where kind=p_kind and resource_id=p_resource_id;
 if not found then raise exception 'PLATFORM_NET_SOURCE_MISSING';end if;
 if p_status not in ('net_verified','awaiting_report','coverage_incomplete','provider_unavailable','requires_review','reversed')
  or p_reason is null or p_reason !~ '^[A-Za-z0-9_]{2,110}$'
 then raise exception 'PLATFORM_NET_OBSERVATION_INVALID';end if;
 if s.reversed then p_status:='reversed';p_reason:='LOCAL_REVERSAL_RECORDED';p_evidence:=null;end if;
 if p_status='reversed' and not s.reversed then raise exception 'PLATFORM_NET_REVERSAL_UNPROVEN';end if;
 if p_status='net_verified' then
  if p_evidence is null or jsonb_typeof(p_evidence)<>'object' or
   p_evidence->>'externalReference' is distinct from s.external_reference or
   (p_evidence->>'grossCents')::bigint is distinct from s.gross_cents or
   p_evidence->>'providerOrderId' is distinct from s.provider_order_id or
   p_kind='advertising' and p_evidence->>'providerPaymentId' is distinct from s.provider_payment_id
  then raise exception 'PLATFORM_NET_SOURCE_BINDING_INVALID';end if;
  n:=(p_evidence->>'netCents')::bigint;released:=(p_evidence->>'releaseAt')::timestamptz;
  if n is null or n<=0 or n>s.gross_cents or released is null or released>clock_timestamp()+interval '5 minutes'
   then raise exception 'PLATFORM_NET_VALUES_INVALID';end if;
  select * into old from public.platform_receipt_net_audit where kind=p_kind and resource_id=p_resource_id;
  if found then
   if old.gross_cents<>s.gross_cents or old.net_cents<>n or old.release_at<>released or
    old.seller_id is distinct from p_evidence->>'sellerId' or
    old.provider_payment_id is distinct from p_evidence->>'providerPaymentId' or
    old.provider_order_id is distinct from s.provider_order_id or old.external_reference<>s.external_reference
   then p_status:='requires_review';p_reason:='IMMUTABLE_RELEASE_EVIDENCE_CONFLICT';end if;
  else
   insert into public.platform_receipt_net_audit(kind,resource_id,gross_cents,net_cents,seller_id,
    provider_order_id,provider_payment_id,external_reference,release_at,report_sha256,evidence_reference)
   values(p_kind,p_resource_id,s.gross_cents,n,p_evidence->>'sellerId',s.provider_order_id,
    p_evidence->>'providerPaymentId',s.external_reference,released,p_evidence->>'reportSha256',p_evidence->>'evidenceReference');
  end if;
 elsif p_evidence is not null then raise exception 'PLATFORM_NET_UNEXPECTED_EVIDENCE';end if;
 insert into public.platform_receipt_net_observations(kind,resource_id,status,reason)
 values(p_kind,p_resource_id,p_status,p_reason) on conflict(kind,resource_id) do update
 set status=excluded.status,reason=excluded.reason,last_checked_at=clock_timestamp();
 return jsonb_build_object('ok',true,'source','platform_receipt_net_evidence','status',p_status,
  'moneyMoved',false,'entitlementsChanged',false);
end $fn$;
revoke all on function public.platform_receipt_net_record(text,uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.platform_receipt_net_record(text,uuid,text,text,jsonb) to service_role;

-- Read projection includes coupons' ORIGINAL canonical NET evidence, even if
-- refunded later. Original release is history, never a current account balance.
create function public.admin_platform_receipt_net_summary(p_actor_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $fn$
declare result jsonb;
begin
 if coalesce(public.platform_admin_role(p_actor_user_id),'') not in ('superadmin','finance')
 then raise exception 'ADMIN_PERMISSION_DENIED' using errcode='42501';end if;
 with sources as (
  select s.kind,s.resource_id,s.business_status,s.gross_cents,s.paid_at,s.reversed,
   a.net_cents,a.recorded_at as verified_at,a.evidence_reference,a.report_sha256,
   o.status as observed_status,o.reason,o.last_checked_at
  from public.platform_receipt_net_sources() s
  left join public.platform_receipt_net_audit a using(kind,resource_id)
  left join public.platform_receipt_net_observations o using(kind,resource_id)
  union all
  select 'coupon',i.id,i.status,i.sale_price_cents,i.paid_at,i.status<>'paid',
   case when i.net_proceeds_cents>0 and i.net_proceeds_cents<=i.sale_price_cents
    and i.net_proceeds_verified_at is not null and i.net_proceeds_reference like 'mp-release:%' then i.net_proceeds_cents end,
   i.net_proceeds_verified_at,i.net_proceeds_reference,null::text,o.status,o.reason,o.last_checked_at
  from public.clube_coupon_paid_invoices i
  left join public.clube_coupon_net_auto_observations_v1_931 o on o.invoice_id=i.id
  where i.paid_at is not null
 ), facts as (
  select *,case when reversed then 'reversed' when observed_status='requires_review' then 'requires_review'
   when net_cents is not null and observed_status='net_verified' then 'net_verified'
   else coalesce(observed_status,'awaiting_report') end as net_status from sources
 ), kinds(kind) as (values('billing'::text),('coupon'),('mobility'),('advertising')),
 totals as (
  select k.kind,count(f.resource_id) as count,
   coalesce(sum(f.gross_cents),0) as gross,
   count(f.resource_id) filter(where f.net_status='net_verified') as verified,
   coalesce(sum(f.net_cents) filter(where f.net_status='net_verified'),0) as verified_net,
   count(f.resource_id) filter(where f.net_status='reversed') as reversed,
   count(f.resource_id) filter(where f.net_status not in ('net_verified','reversed')) as pending
  from kinds k left join facts f using(kind) group by k.kind
 ), recent as (select * from facts order by paid_at desc,resource_id limit 30)
 select jsonb_build_object('source','platform_receipt_net_summary','readOnly',true,
  'moneyMoved',false,'merchantFundsIncluded',false,'accountBalanceVerified',false,
  'generatedAt',clock_timestamp(),'totalCount',(select count(*) from facts),
  'returnedCount',(select count(*) from recent),'truncated',(select count(*)>30 from facts),
  'kindTotals',(select jsonb_object_agg(kind,jsonb_build_object('count',count,'grossCents',gross,
   'verifiedCount',verified,'verifiedNetCents',verified_net,'reversedCount',reversed,'pendingCount',pending)) from totals),
  'rows',coalesce((select jsonb_agg(jsonb_build_object('kind',kind,'resourceId',resource_id,
   'businessStatus',business_status,'grossCents',gross_cents,'paidAt',paid_at,'netStatus',net_status,
   'netCents',net_cents,'verifiedAt',verified_at,'lastCheckedAt',last_checked_at,'reason',reason,
   'evidenceReference',evidence_reference,'reportSha256',report_sha256) order by paid_at desc,resource_id) from recent),'[]'::jsonb)) into result;
 return result;
end $fn$;
revoke all on function public.admin_platform_receipt_net_summary(uuid) from public,anon,authenticated;
grant execute on function public.admin_platform_receipt_net_summary(uuid) to service_role;
