begin;

-- Extend the original obligation; no parallel advertising payment ledger.
alter table public.ads_independent_checkouts_v1_886
 add column payment_channel text not null default 'checkout_pro'
   check(payment_channel in ('checkout_pro','pix')),
 add column pix_stage text not null default 'idle'
   check(pix_stage in ('idle','closing','creating','ready')),
 add column pix_started_at timestamptz,
 add column pix_br_code text check(pix_br_code is null or length(pix_br_code) between 30 and 8192),
 add column pix_expires_at timestamptz,
 add column legacy_closed_at timestamptz,
 add column legacy_closure_sha256 text check(legacy_closure_sha256 is null or legacy_closure_sha256 ~ '^[a-f0-9]{64}$'),
 add column pix_origin text check(pix_origin in ('owner','system_repair'));

alter table public.ads_independent_checkouts_v1_886
 drop constraint ads_independent_checkouts_v1_886_check,
 add constraint ads_independent_checkout_instrument_shape check(
  (payment_channel='checkout_pro' and (
    (status='reserved' and preference_id is null and checkout_url is null and payment_id is null)
    or (status='checkout_ready' and preference_id is not null and checkout_url is not null and payment_id is null)
    or (status in ('payment_approved','payment_reversed','review_required') and preference_id is not null and payment_id is not null)))
  or (payment_channel='pix' and pix_started_at is not null and pix_origin is not null and (
    (pix_stage='creating' and status in ('reserved','checkout_ready') and payment_id is null and pix_br_code is null)
    or (pix_stage='ready' and status='checkout_ready' and payment_id is not null and collector_id is not null
      and pix_br_code is not null and pix_expires_at is not null)
    or (status in ('payment_approved','payment_reversed','review_required') and payment_id is not null)))
 );

create function public.ads_pix_begin(p_owner uuid,p_campaign uuid,p_origin text default 'owner')
returns jsonb language plpgsql security definer set search_path=pg_catalog as $fn$
declare c public.ads_independent_checkouts_v1_886%rowtype;
begin
 select * into c from public.ads_independent_checkouts_v1_886
 where campaign_id=p_campaign and owner_user_id=p_owner for update;
 if not found or p_origin is null or p_origin not in ('owner','system_repair') or c.terms_accepted_at is null
   or not exists(select 1 from auth.users where id=p_owner and is_anonymous is false and email_confirmed_at is not null)
   or not exists(select 1 from public.ads_independent_campaigns_v1_884
      where id=c.campaign_id and owner_user_id=p_owner and status='approved'
       and budget_cents=c.amount_cents and duration_days=c.duration_days)
 then raise exception 'ADS_PIX_OWNED_OBLIGATION_REQUIRED' using errcode='42501';end if;
 if p_origin='system_repair' and not exists(
   select 1 from public.ads_independent_sales_controls_v1_886
   where singleton and homologation_campaign_id=c.campaign_id and homologation_expires_at>clock_timestamp()
    and c.amount_cents=1990 and c.duration_days=7 and c.preference_id is not null)
 then raise exception 'ADS_PIX_EXISTING_TEST_REQUIRED' using errcode='42501';end if;
 if c.status not in ('reserved','checkout_ready') or c.expires_at<=clock_timestamp()+interval '60 seconds'
 then raise exception 'ADS_PIX_NOT_PAYABLE' using errcode='42501';end if;
 if c.pix_stage='idle' then
  update public.ads_independent_checkouts_v1_886 set pix_stage='closing',
   pix_started_at=clock_timestamp(),pix_origin=p_origin,updated_at=clock_timestamp()
   where campaign_id=c.campaign_id returning * into c;
 end if;
 return jsonb_build_object('source','ads_pix_begin','checkout',to_jsonb(c));
end;$fn$;
revoke all on function public.ads_pix_begin(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.ads_pix_begin(uuid,uuid,text) to service_role;

-- Exactly one caller may create the Pix instrument. Replays only recover it.
create function public.ads_pix_claim(p_owner uuid,p_campaign uuid,p_preference text,p_closure_sha text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $fn$
declare c public.ads_independent_checkouts_v1_886%rowtype;
begin
 select * into c from public.ads_independent_checkouts_v1_886
 where campaign_id=p_campaign and owner_user_id=p_owner for update;
 if not found or c.status not in ('reserved','checkout_ready') or c.pix_started_at is null
  or c.pix_started_at+interval '24 hours'<=clock_timestamp()+interval '60 seconds'
 then raise exception 'ADS_PIX_CLAIM_DENIED' using errcode='42501';end if;
 if c.pix_stage in ('creating','ready') then
  return jsonb_build_object('source','ads_pix_claim','canCreate',false,'checkout',to_jsonb(c));
 end if;
 if c.pix_stage<>'closing' or c.preference_id is distinct from p_preference
  or (c.preference_id is not null and (p_closure_sha is null or p_closure_sha !~ '^[a-f0-9]{64}$'))
 then raise exception 'ADS_PIX_LEGACY_CLOSURE_REQUIRED' using errcode='42501';end if;
 update public.ads_independent_checkouts_v1_886 set payment_channel='pix',pix_stage='creating',status='checkout_ready',
  checkout_url=null,legacy_closed_at=case when preference_id is not null then clock_timestamp() else null end,
  legacy_closure_sha256=p_closure_sha,updated_at=clock_timestamp()
  where campaign_id=c.campaign_id returning * into c;
 return jsonb_build_object('source','ads_pix_claim','canCreate',true,'checkout',to_jsonb(c));
end;$fn$;
revoke all on function public.ads_pix_claim(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.ads_pix_claim(uuid,uuid,text,text) to service_role;

create function public.ads_pix_attach(p_owner uuid,p_campaign uuid,p_payment text,p_collector text,
 p_amount integer,p_code text,p_expires timestamptz)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $fn$
declare c public.ads_independent_checkouts_v1_886%rowtype;
begin
 select * into c from public.ads_independent_checkouts_v1_886
 where campaign_id=p_campaign and owner_user_id=p_owner for update;
 if not found or p_payment is null or p_collector is null or p_code is null or p_expires is null
  or c.amount_cents is distinct from p_amount or c.pix_stage not in ('closing','creating','ready')
  or p_payment !~ '^[0-9]{5,30}$' or p_collector !~ '^[0-9]{4,20}$'
  or length(p_code) not between 30 and 8192 or p_code not like '000201%'
  or p_expires<=clock_timestamp()+interval '60 seconds' or p_expires>clock_timestamp()+interval '3 days'
  or (c.payment_id is not null and c.payment_id<>p_payment)
  or (c.collector_id is not null and c.collector_id<>p_collector)
 then raise exception 'ADS_PIX_PROVIDER_PROOF_MISMATCH' using errcode='42501';end if;
 if c.status in ('payment_approved','payment_reversed','review_required') then
  return jsonb_build_object('source','ads_pix_attach','status',c.status,'pixPayable',false);
 end if;
 if c.status not in ('reserved','checkout_ready') then
  raise exception 'ADS_PIX_ATTACH_DENIED' using errcode='42501';end if;
 update public.ads_independent_checkouts_v1_886 set payment_channel='pix',pix_stage='ready',
  status='checkout_ready',payment_id=p_payment,collector_id=p_collector,
  pix_br_code=p_code,pix_expires_at=p_expires,expires_at=p_expires,
  checkout_url=null,provider_status='pending',provider_status_detail='pending_waiting_transfer',
  updated_at=clock_timestamp() where campaign_id=c.campaign_id;
 return jsonb_build_object('source','ads_pix_attach','status','checkout_ready','pixPayable',true);
end;$fn$;
revoke all on function public.ads_pix_attach(uuid,uuid,text,text,integer,text,timestamptz) from public,anon,authenticated;
grant execute on function public.ads_pix_attach(uuid,uuid,text,text,integer,text,timestamptz) to service_role;

-- Native sale Pix still belongs to the seller and the original order attempt.
alter table public.merchant_sale_payment_attempts
 add column pix_br_code text check(pix_br_code is null or length(pix_br_code) between 30 and 8192),
 add column pix_expires_at timestamptz;
create function public.merchant_sale_pix_attach(p_customer uuid,p_order uuid,p_attempt uuid,
 p_provider_order text,p_amount bigint,p_code text,p_expires timestamptz)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $fn$
declare a public.merchant_sale_payment_attempts%rowtype;
begin
 select * into a from public.merchant_sale_payment_attempts where id=p_attempt and order_id=p_order for update;
 if not found or p_provider_order is null or p_code is null or p_expires is null
  or a.amount_cents is distinct from p_amount or a.payment_method_snapshot is distinct from 'pix'
  or a.provider<>'mercadopago' or a.funds_owner<>'merchant'
  or (a.provider_order_id is not null and a.provider_order_id<>p_provider_order)
  or not exists(select 1 from public.orders o where o.id=p_order and o.customer_id=p_customer
      and o.merchant_id=a.merchant_id and o.total_cents=p_amount and o.payment_timing='prepaid')
  or p_provider_order !~ '^[A-Za-z0-9_-]{6,240}$' or length(p_code) not between 30 and 8192
  or p_code not like '000201%' or p_expires<=clock_timestamp()+interval '60 seconds'
  or p_expires>clock_timestamp()+interval '24 hours 5 minutes'
 then raise exception 'SALE_PIX_OWNED_PROOF_REQUIRED' using errcode='42501';end if;
 if a.status='approved' then return jsonb_build_object('source','merchant_sale_pix_attach','alreadyPaid',true);end if;
 if (a.status not in ('preparing','checkout_ready','pending') and not (a.status='review_required' and a.last_error_code in ('PROVIDER_CHECKOUT_OUTCOME_UNKNOWN','PROVIDER_CHECKOUT_COMMIT_FAILED'))) or a.released_for_order_change_at is not null
  or not exists(select 1 from public.orders where id=p_order and status in
    ('MERCHANT_ACCEPTED','PREPARING','AT_RISK','OUT_FOR_DELIVERY','ARRIVING'))
 then raise exception 'SALE_PIX_NOT_PAYABLE' using errcode='42501';end if;
 update public.merchant_sale_payment_attempts set checkout_mode='pix',status='pending',
  provider_order_id=p_provider_order,pix_br_code=p_code,pix_expires_at=p_expires,
  expires_at=p_expires,checkout_url=null,last_error_code=null,last_error_at=null,updated_at=clock_timestamp() where id=a.id;
 return jsonb_build_object('source','merchant_sale_pix_attach','alreadyPaid',false,'status','pending');
end;$fn$;
revoke all on function public.merchant_sale_pix_attach(uuid,uuid,uuid,text,bigint,text,timestamptz) from public,anon,authenticated;
grant execute on function public.merchant_sale_pix_attach(uuid,uuid,uuid,text,bigint,text,timestamptz) to service_role;

commit;
