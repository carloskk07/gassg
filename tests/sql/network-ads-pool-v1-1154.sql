\set ON_ERROR_STOP on
-- TAMÃO V1.1154: PostgreSQL descartável — nenhuma chamada ao PSP nem dinheiro.
begin;
set local statement_timeout='90s';
do $test$
declare
 v_owner uuid:=gen_random_uuid();v_a uuid:=gen_random_uuid();v_b uuid:=gen_random_uuid();
 v_admin uuid:=gen_random_uuid();v_campaign uuid:=gen_random_uuid();
 v_fixed uuid:=gen_random_uuid();v_topup uuid:=gen_random_uuid();
 v_token uuid:=gen_random_uuid();v_view uuid:=gen_random_uuid();
 v_at timestamptz:=clock_timestamp()-interval '1 day';
 v_close timestamptz;v_result jsonb;v_summary jsonb;v_awards bigint;
 v_count bigint;v_state text;v_denied boolean;
begin
 -- A legacy pool remains PAUSED until terms; Ads reserve is independent of payout.
 if (select accrual_enabled from public.network_fee_package_policy_v1_1030 where singleton)
    or not (select accrual_enabled from public.network_ads_pool_policy_v1_1154 where singleton)
    or (select payouts_enabled from public.network_ads_pool_policy_v1_1154 where singleton)
 then raise exception 'ADS_POOL_POLICY_GATES_INVALID';end if;
 if has_function_privilege('authenticated','public.network_ads_pool_tick_v1_1154(integer)','execute')
    or has_function_privilege('anon','public.network_ads_pool_admin_summary_v1_1154(uuid)','execute')
    or has_table_privilege('authenticated','public.network_fee_package_sources_v1_1030','insert')
    or has_table_privilege('anon','public.network_ads_pool_policy_v1_1154','select')
 then raise exception 'ADS_POOL_PRIVILEGE_LEAK';end if;

 insert into auth.users(id,aud,role,is_anonymous,email,email_confirmed_at)
 values(v_owner,'authenticated','authenticated',false,'ads1154-owner@example.invalid',clock_timestamp()),
 (v_a,'authenticated','authenticated',false,'ads1154-a@example.invalid',clock_timestamp()),
 (v_b,'authenticated','authenticated',false,'ads1154-b@example.invalid',clock_timestamp()),
 (v_admin,'authenticated','authenticated',false,'ads1154-admin@example.invalid',clock_timestamp());
 insert into public.platform_admins(user_id,admin_role,active) values(v_admin,'superadmin',true);
 v_close:=(((v_at at time zone 'America/Sao_Paulo')::date+1)::timestamp
      at time zone 'America/Sao_Paulo');
 insert into public.network_member_visits_v1_1030(user_id,visit_hour,last_visit_at,portal)
 values(v_a,date_trunc('hour',v_close-interval '2 hours'),v_close-interval '2 hours','customer'),
 (v_b,date_trunc('hour',v_close-interval '1 hour'),v_close-interval '1 hour','customer'),
 (v_admin,date_trunc('hour',v_close-interval '1 hour'),v_close-interval '1 hour','customer'),
 (v_owner,date_trunc('hour',v_close-interval '1 hour'),v_close-interval '1 hour','customer');
 update public.network_ads_pool_policy_v1_1154
   set effective_after=v_at-interval '1 minute' where singleton;

 -- Paid credit, NOT just a recharge: a server-charged view with wallet debit.
 insert into public.ads_credit_wallets_v1_1097(owner_user_id,balance_cents,total_loaded_cents,total_spent_cents)
 values(v_owner,1988,1990,2);
 insert into public.ads_credit_topups_v1_1097
  (id,owner_user_id,request_id,external_reference,amount_cents,status,
   provider_payment_id,collector_id,provider_status,paid_at)
 values(v_topup,v_owner,gen_random_uuid(),
  'tamao-ads-credit-'||replace(v_topup::text,'-',''),1990,'approved',
  '115400001234','115400000','approved',v_at-interval '2 hours');
 insert into public.ads_credit_ledger_v1_1097
  (owner_user_id,event_key,topup_id,operation,delta_cents,balance_after_cents)
 values(v_owner,'ads-test-load-'||v_topup::text,v_topup,'topup',1990,1990);
 insert into public.ads_credit_campaigns_v1_1098
  (id,owner_user_id,request_id,request_signature,advertiser_name,title,description,
   city,state,destination_url,status)
 values(v_campaign,v_owner,gen_random_uuid(),repeat('a',32),'Anunciante Teste',
 'Campanha de teste local','Esta campanha é exclusivamente um teste isolado.',
 'São Gabriel','RS','https://example.com/teste','active');
 insert into public.ads_credit_challenges_v1_1098(token,campaign_id,viewer_hash,issued_at,expires_at)
 values(v_token,v_campaign,repeat('c',64),v_at-interval '10 seconds',v_at+interval '1 minute');
 insert into public.ads_credit_view_receipts_v1_1098
  (id,token,campaign_id,owner_user_id,viewer_hash,visible_ms,visible_percent,charged_cents,recorded_at)
 values(v_view,v_token,v_campaign,v_owner,repeat('c',64),1800,75,2,v_at);
 insert into public.ads_credit_ledger_v1_1097
  (owner_user_id,event_key,source_view_id,operation,delta_cents,balance_after_cents)
 values(v_owner,'credit-view:'||v_view::text,v_view,'view',-2,1988);

 v_result:=public.network_ads_pool_tick_v1_1154();
 if v_result->>'recordedSources'<>'1' or v_result->>'recordedAwards'<>'2'
   or v_result->>'payoutsExecuted'<>'0'
 then raise exception 'ADS_VIEW_ACCRUAL_INVALID:%',v_result;end if;
 select coalesce(sum(equal_microcents),0),count(*) into v_awards,v_count
 from public.network_fee_package_awards_v1_1030
 where kind='ads_verified_view' and source_id=v_view;
 if v_awards<>200000 or v_count<>2 then
   raise exception 'ADS_VIEW_SUBCENT_10PCT_NOT_CONSERVED';end if;
 if exists(select 1 from public.network_fee_package_awards_v1_1030
    where source_id=v_view and user_id in (v_owner,v_admin))
 then raise exception 'ADS_ADVERTISER_OR_ADMIN_WAS_REWARDED';end if;
 v_result:=public.network_ads_pool_tick_v1_1154();
 if v_result->>'recordedSources'<>'0' then raise exception 'ADS_VIEW_REPLAY_DOUBLE_ALLOCATION';end if;

 -- Campaign with fixed period: provider verified NET receipt + delivered term.
 insert into public.ads_independent_campaigns_v1_884
  (id,owner_user_id,request_id,request_signature,advertiser_name,title,description,
   city,state,destination_url,budget_cents,duration_days,status,run_started_at,run_ends_at)
 values(v_fixed,v_owner,gen_random_uuid(),repeat('e',32),'Anunciante Exemplo',
 'Campanha de duração fixa','Publicidade isolada com prazo entregue e comprovado.',
 'São Gabriel','RS','https://example.com/anuncio',1990,7,'ended',
  v_at-interval '7 days',v_at);
 insert into public.ads_independent_checkouts_v1_886
  (campaign_id,owner_user_id,request_id,external_reference,amount_cents,duration_days,
   status,preference_id,checkout_url,payment_id,collector_id,provider_status,approved_at)
 values(v_fixed,v_owner,gen_random_uuid(),
  'tamao-ads-ind-'||replace(v_fixed::text,'-',''),1990,7,'payment_approved',
  'pref-1154-'||substr(v_fixed::text,1,8),'https://www.mercadopago.com.br/checkout/v1154',
  '115488880000','115400000','approved',v_at-interval '7 days');
 insert into public.platform_receipt_net_audit
   (kind,resource_id,gross_cents,net_cents,seller_id,provider_order_id,
    provider_payment_id,external_reference,release_at,report_sha256,evidence_reference)
 values('advertising',v_fixed,1990,1970,'222333444','ADS1154CIORDER',
   '115488880000','tamao-ads-ind-'||replace(v_fixed::text,'-',''),
   v_at-interval '6 hours',repeat('a',64),
   'mp-release:CI-ADS-ISOLATED-ONLY.csv:115488880000');
 insert into public.platform_receipt_net_observations(kind,resource_id,status,reason)
 values('advertising',v_fixed,'net_verified','CI_SYNTHETIC_AD_NET_PROOF');
 v_result:=public.network_ads_pool_tick_v1_1154();
 if v_result->>'recordedSources'<>'1' or v_result->>'recordedAwards'<>'2'
 then raise exception 'ADS_FIXED_DELIVERED_RECEIPT_NOT_RECOGNIZED:%',v_result;end if;
 select coalesce(sum(equal_microcents),0),count(*) into v_awards,v_count
 from public.network_fee_package_awards_v1_1030
 where kind='ads_fixed_campaign' and source_id=v_fixed;
 if v_awards<>199000000 or v_count<>2 then
   raise exception 'ADS_FIXED_GROSS_10PCT_NOT_CONSERVED';end if;
 v_summary:=public.network_member_benefit_statement_v1_1045(v_a,'rede',1,25);
 if v_summary::text not like '%Publicidade por visualização%'
    or v_summary::text not like '%Publicidade por período%'
    or v_summary->>'moneyMoved'<>'false'
 then raise exception 'ADS_PUBLICITY_MISSING_IN_NETWORK_STATEMENT:%',v_summary;end if;
 v_summary:=public.network_ads_pool_admin_summary_v1_1154(v_admin);
 if v_summary->>'payoutsEnabled'<>'false'
   or jsonb_array_length(v_summary->'sources')<>2 then
   raise exception 'ADS_ADMIN_AGGREGATE_WRONG:%',v_summary;end if;
 v_denied:=false;
 begin
   perform public.network_ads_pool_admin_summary_v1_1154(v_a);
 exception when insufficient_privilege then v_denied:=true;end;
 if not v_denied then raise exception 'ADS_ADMIN_REPORT_PRIVILEGE_LEAK';end if;

 -- Existing packages ticker must never mistake Ads as mobility prepaids.
 perform public.network_fee_package_tick_v1_1030();
 if (select count(*) from public.network_fee_package_sources_v1_1030
   where kind like 'ads_%' and state='reversed')<>0
 then raise exception 'ADS_SOURCES_REVERSED_BY_LEGACY_TICK';end if;
 -- Allow old receipts to mature exclusively within this ROLLBACK proof.
 update public.network_fee_package_sources_v1_1030
 set closed_at=clock_timestamp()-interval '8 days'
 where kind in ('ads_verified_view','ads_fixed_campaign');
 v_result:=public.network_ads_pool_tick_v1_1154();
 if v_result->>'matured'<>'2' or
  (select count(*) from public.network_fee_package_sources_v1_1030
   where kind like 'ads_%' and state='eligible')<>2 then
   raise exception 'ADS_MATURITY_NOT_FINANCIALLY_VERIFIED:%',v_result;end if;

 -- Refund after validation changes STATE, never adds another credit or Pix.
 update public.ads_credit_topups_v1_1097
 set status='reversed',reversed_cents=1990,reversed_at=clock_timestamp()
 where id=v_topup;
 update public.ads_independent_checkouts_v1_886
 set status='payment_reversed',reversed_at=clock_timestamp()
 where campaign_id=v_fixed;
 v_result:=public.network_ads_pool_tick_v1_1154();
 if v_result->>'reversed'<>'2' or
   (select count(*) from public.network_fee_package_sources_v1_1030
    where kind like 'ads_%' and state='reversed')<>2
 then raise exception 'ADS_REFUND_REVERSAL_NOT_CONSERVED:%',v_result;end if;
 if (select count(*) from public.network_fee_package_awards_v1_1030 where kind like 'ads_%')<>4
 then raise exception 'ADS_REFUND_MUST_PRESERVE_AUDIT_TRAIL';end if;
 if (select count(*) from public.network_fee_payout_reservations_v1_1031)<>0
 then raise exception 'ADS_POOL_CREATED_EXTERNAL_PAYOUT';end if;
 raise notice 'V1.1154 PASS — paid views, fixed ads, 10%% gross subcent, 24h, replay, 7-day hold, refunds, ACL, no payouts';
end $test$;
rollback;
