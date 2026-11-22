-- V1.1156 — fail closed on disputed Ads after maturity; never Pix or refund.
begin;
alter table public.network_fee_package_sources_v1_1030 add column ads_hold_reason text check(ads_hold_reason is null or ads_hold_reason in ('FINANCIAL_REVIEW','REVERSED'));
create function public.network_ads_pool_dispute_guard_v1_1156()
returns trigger language plpgsql security definer set search_path=pg_catalog as $guard$
begin
 if old.state='eligible' and new.state='pending'
    and new.kind in ('ads_verified_view','ads_fixed_campaign') then
  update public.network_fee_payout_reservations_v1_1031 r
    set state='reversal_review'
    where r.state='reserved' and exists(
      select 1 from public.network_fee_payout_allocations_v1_1031 x
      where x.reservation_id=r.id and x.kind=new.kind and x.source_id=new.source_id);
  update public.network_manual_payout_requests_v1_1034 m
    set state='review',review_at=clock_timestamp(),review_reason='ADS_SOURCE_IN_REVIEW'
    where m.state in('requested','approved') and exists(
      select 1 from public.network_fee_payout_allocations_v1_1031 x
      where x.reservation_id=m.reservation_id and x.kind=new.kind and x.source_id=new.source_id);
  update public.network_fee_package_offsets_v1_1032 o
    set state='reversal_review',review_at=clock_timestamp()
    where o.state in('reserved','applied') and exists(
      select 1 from public.network_fee_package_offset_allocations_v1_1032 x
      where x.offset_id=o.id and x.kind=new.kind and x.source_id=new.source_id);
  update public.merchant_billing_accounts b
    set sales_hold=true,sales_hold_reason='network_ads_dispute_review',
        sales_hold_at=clock_timestamp(),updated_at=clock_timestamp()
    where exists(select 1 from public.network_fee_package_offsets_v1_1032 o
      where o.merchant_id=b.merchant_id and o.state='reversal_review'
        and o.applied_at is not null);
  update public.network_payout_jobs_v1_1033 j
    set state='review',review_reason='ADS_SOURCE_IN_REVIEW',updated_at=clock_timestamp()
    where j.state not in('cancelled','rejected','refunded','review','paid')
      and exists(select 1 from public.network_fee_payout_allocations_v1_1031 x
        where x.reservation_id=j.reservation_id and x.kind=new.kind and x.source_id=new.source_id);
 end if;
 return new;
end $guard$;
create trigger network_ads_pool_dispute_guard_trg_v1_1156
after update of state on public.network_fee_package_sources_v1_1030
for each row execute function public.network_ads_pool_dispute_guard_v1_1156();
revoke all on function public.network_ads_pool_dispute_guard_v1_1156() from public,anon,authenticated;

CREATE OR REPLACE FUNCTION public.network_ads_pool_tick_v1_1154(p_limit integer DEFAULT 250)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
 v_policy public.network_ads_pool_policy_v1_1154%rowtype;
 v_old record;v_src record;v_members uuid[];
 v_close timestamptz;v_pool bigint;v_each bigint;v_rem bigint;v_share bigint;
 v_safe boolean;v_reversed boolean;v_count integer;v_i integer;
 v_new integer:=0;v_awards integer:=0;v_matured integer:=0;v_revoked integer:=0;v_held integer:=0;
begin
 if p_limit is null or p_limit<1 or p_limit>1000 then
   raise exception 'ADS_NETWORK_BATCH_INVALID' using errcode='22023';
 end if;
 perform pg_advisory_xact_lock(hashtextextended('tamao-network-ads-pool-1154',0));
 select * into strict v_policy from public.network_ads_pool_policy_v1_1154 where singleton for update;

 -- Rotating review queue: every pending/eligible source is eventually revisited
 -- after payment disputes. Benefits never mature during a disputed wallet.
 for v_old in
  select * from public.network_fee_package_sources_v1_1030
   where kind in ('ads_verified_view','ads_fixed_campaign')
     and state in ('pending','eligible')
   order by ads_reviewed_at asc nulls first,recorded_at
   limit p_limit for update
 loop
  v_safe:=false;v_reversed:=false;
  if v_old.kind='ads_verified_view' then
    select exists(
      select 1 from public.ads_credit_view_receipts_v1_1098 r
      join public.ads_credit_ledger_v1_1097 l
        on l.source_view_id=r.id and l.operation='view'
       and l.event_key='credit-view:'||r.id::text
       and l.delta_cents=-r.charged_cents
      join public.ads_credit_wallets_v1_1097 w on w.owner_user_id=r.owner_user_id
      where r.id=v_old.source_id and r.owner_user_id=v_old.buyer_user_id
       and r.charged_cents=v_old.gross_cents
       and not w.frozen and w.disputed_cents=0
       and exists(select 1 from public.ads_credit_topups_v1_1097 t
         where t.owner_user_id=r.owner_user_id and t.status='approved'
          and t.reversed_cents=0 and t.paid_at<=r.recorded_at
          and t.provider_payment_id is not null)
       and not exists(select 1 from public.ads_credit_topups_v1_1097 t
         where t.owner_user_id=r.owner_user_id and t.paid_at is not null
           and (t.reversed_cents>0 or t.status in ('reversed','review_required')))
    ) into v_safe;
    select exists(
      select 1 from public.ads_credit_topups_v1_1097 t
      where t.owner_user_id=v_old.buyer_user_id and t.paid_at is not null
        and (t.reversed_cents>0 or t.status='reversed')
    ) into v_reversed;
  else
    select exists(
      select 1 from public.ads_independent_checkouts_v1_886 c
      join public.ads_independent_campaigns_v1_884 camp on camp.id=c.campaign_id
      join public.platform_receipt_net_audit a
        on a.kind='advertising' and a.resource_id=c.campaign_id
         and a.gross_cents=c.amount_cents
      join public.platform_receipt_net_observations o
        on o.kind='advertising' and o.resource_id=c.campaign_id
         and o.status='net_verified'
      where c.campaign_id=v_old.source_id and c.owner_user_id=v_old.buyer_user_id
       and c.status='payment_approved' and c.approved_at is not null
       and c.payment_id is not null and a.net_cents>0
       and a.release_at<=clock_timestamp() and camp.run_ends_at<=clock_timestamp()
       and camp.status in ('active','ended')
       and not exists(select 1 from public.ads_independent_refund_cases_v1_887 rc
         where rc.campaign_id=c.campaign_id)
       and not exists(select 1 from public.ads_independent_refund_executions_v1_888 re
         where re.campaign_id=c.campaign_id)
    ) into v_safe;
    select exists(
      select 1 from public.ads_independent_checkouts_v1_886 c
       where c.campaign_id=v_old.source_id and c.status='payment_reversed'
    ) or exists(
      select 1 from public.platform_receipt_net_observations o
       where o.kind='advertising' and o.resource_id=v_old.source_id
         and o.status='reversed'
    ) or exists(
      select 1 from public.ads_independent_refund_executions_v1_888 re
       where re.campaign_id=v_old.source_id and re.status='provider_refunded'
    ) into v_reversed;
  end if;
  if v_reversed then
    update public.network_fee_package_sources_v1_1030
      set state='reversed',reversed_at=clock_timestamp(),matured_at=null,
       ads_hold_reason='REVERSED',ads_reviewed_at=clock_timestamp()
      where kind=v_old.kind and source_id=v_old.source_id;
    v_revoked:=v_revoked+1;
  elsif not v_safe then
    -- A wallet freeze, provisional refund or loss of verified NET proof
    -- must immediately suspend a previously eligible award.
    update public.network_fee_package_sources_v1_1030
       set state='pending',matured_at=null,ads_hold_reason='FINANCIAL_REVIEW',
           ads_reviewed_at=clock_timestamp()
     where kind=v_old.kind and source_id=v_old.source_id;
    if v_old.state='eligible' then v_held:=v_held+1;end if;
  elsif v_safe and v_old.state='pending'
       and clock_timestamp()>=v_old.closed_at+make_interval(days=>v_policy.maturity_days) then
    update public.network_fee_package_sources_v1_1030
      set state='eligible',matured_at=clock_timestamp(),ads_hold_reason=null,ads_reviewed_at=clock_timestamp()
      where kind=v_old.kind and source_id=v_old.source_id;
    v_matured:=v_matured+1;
  else
    update public.network_fee_package_sources_v1_1030
      set ads_reviewed_at=clock_timestamp(),ads_hold_reason=null
      where kind=v_old.kind and source_id=v_old.source_id;
  end if;
 end loop;

 if not v_policy.accrual_enabled then
   return jsonb_build_object('source','network_ads_pool_v1_1154',
    'accrualEnabled',false,'recordedSources',0,'recordedAwards',0,
    'matured',v_matured,'reversed',v_revoked,'heldForReview',v_held,'payoutsExecuted',0);
 end if;

 -- Exactly one commercial receipt / fund entry. No topup-only award.
 -- A credit-view debit is backed by a confirmed funded wallet.
 -- For fixed-price campaigns: require completed service AND PSP net evidence.
 for v_src in
  select * from (
   select 'ads_verified_view'::text as kind,r.id as source_id,
    r.owner_user_id as buyer_user_id,r.charged_cents::bigint gross_cents,
    r.charged_cents::bigint net_cents,r.recorded_at earned_at,
    ('credit-view:'||r.id::text)::text receipt_reference
   from public.ads_credit_view_receipts_v1_1098 r
   join public.ads_credit_ledger_v1_1097 l
    on l.source_view_id=r.id and l.operation='view'
     and l.event_key='credit-view:'||r.id::text
     and l.delta_cents=-r.charged_cents
   join public.ads_credit_wallets_v1_1097 w
     on w.owner_user_id=r.owner_user_id and not w.frozen and w.disputed_cents=0
   where r.recorded_at>=v_policy.effective_after
    and exists(select 1 from public.ads_credit_topups_v1_1097 t
      where t.owner_user_id=r.owner_user_id and t.status='approved'
       and t.reversed_cents=0 and t.paid_at<=r.recorded_at
       and t.provider_payment_id is not null)
    and not exists(select 1 from public.ads_credit_topups_v1_1097 t
      where t.owner_user_id=r.owner_user_id and t.paid_at is not null
       and (t.reversed_cents>0 or t.status in ('reversed','review_required')))
   union all
   select 'ads_fixed_campaign'::text,c.campaign_id,c.owner_user_id,
    c.amount_cents::bigint,a.net_cents,camp.run_ends_at,
    a.evidence_reference
   from public.ads_independent_checkouts_v1_886 c
   join public.ads_independent_campaigns_v1_884 camp on camp.id=c.campaign_id
   join public.platform_receipt_net_audit a on a.kind='advertising'
     and a.resource_id=c.campaign_id and a.gross_cents=c.amount_cents
   join public.platform_receipt_net_observations o
     on o.kind='advertising' and o.resource_id=c.campaign_id
      and o.status='net_verified'
   where c.status='payment_approved' and c.approved_at is not null
    and c.payment_id is not null and a.release_at<=clock_timestamp()
    and camp.run_ends_at>=v_policy.effective_after
    and camp.run_ends_at<=clock_timestamp() and camp.status in ('active','ended')
    and a.net_cents>0
    and not exists(select 1 from public.ads_independent_refund_cases_v1_887 rc
       where rc.campaign_id=c.campaign_id)
    and not exists(select 1 from public.ads_independent_refund_executions_v1_888 re
       where re.campaign_id=c.campaign_id)
  ) x
  where x.earned_at is not null
   and (((x.earned_at at time zone 'America/Sao_Paulo')::date+1)::timestamp
      at time zone 'America/Sao_Paulo')<=clock_timestamp()
   and not exists(select 1 from public.network_fee_package_sources_v1_1030 s
      where s.kind=x.kind and s.source_id=x.source_id)
  order by x.earned_at,x.kind,x.source_id limit p_limit
 loop
   if v_src.gross_cents<=0 or v_src.gross_cents>1000000000 or
      v_src.net_cents<=0 or v_src.net_cents>v_src.gross_cents then
      raise exception 'ADS_POOL_SOURCE_ECONOMICS_INVALID';
   end if;
   v_close:=(((v_src.earned_at at time zone 'America/Sao_Paulo')::date+1)::timestamp
     at time zone 'America/Sao_Paulo');
   -- User verified active within the same 24-hour window, excluding advertiser.
   select array_agg(user_id order by user_id) into v_members from (
     select distinct visit.user_id from public.network_member_visits_v1_1030 visit
     join auth.users u on u.id=visit.user_id and u.is_anonymous=false
       and u.deleted_at is null
       and (u.email_confirmed_at is not null or u.phone_confirmed_at is not null)
       and (u.banned_until is null or u.banned_until<clock_timestamp())
     where visit.last_visit_at>v_close-interval '24 hours'
       and visit.last_visit_at<=v_close
       and visit.user_id is distinct from v_src.buyer_user_id
       and not exists(select 1 from public.platform_admins adm
        where adm.user_id=visit.user_id and adm.active)
   ) u;
   v_count:=coalesce(array_length(v_members,1),0);
   -- 10% sobre cobrança efetivamente consumida (views) ou campanha concluída
   -- de cobrança paga verificada; PSP custos não reduzem a alíquota de 10%.
   v_pool:=v_src.gross_cents*100000;
   insert into public.network_fee_package_sources_v1_1030(
      kind,source_id,buyer_user_id,merchant_id,credit_entry_id,
      gross_cents,net_cents,fee_credit_cents,pool_microcents,
      attributed_at,closed_at,receipt_reference,state,referrer_user_id,
      ads_reviewed_at)
   values(v_src.kind,v_src.source_id,v_src.buyer_user_id,null,null,
      v_src.gross_cents,v_src.net_cents,v_src.gross_cents,v_pool,
      v_src.earned_at,v_close,v_src.receipt_reference,
      case when v_count>0 then 'pending' else 'unallocated' end,
      null,clock_timestamp())
   on conflict(kind,source_id) do nothing;
   if not found then continue;end if;
   v_new:=v_new+1;
   if v_count>0 then
     v_each:=v_pool/v_count;v_rem:=mod(v_pool,v_count);
     for v_i in 1..v_count loop
       v_share:=v_each+case when v_i<=v_rem then 1 else 0 end;
       if v_share<=0 then continue;end if;
       insert into public.network_fee_package_awards_v1_1030(
         kind,source_id,user_id,equal_microcents,inviter_microcents)
       values(v_src.kind,v_src.source_id,v_members[v_i],v_share,0);
       v_awards:=v_awards+1;
     end loop;
   end if;
 end loop;
 return jsonb_build_object('source','network_ads_pool_v1_1154',
   'accrualEnabled',true,'poolBps',1000,'recordedSources',v_new,
   'recordedAwards',v_awards,'matured',v_matured,'reversed',v_revoked,
   'heldForReview',v_held,'payoutsExecuted',0);
end $function$
;
revoke all on function public.network_ads_pool_tick_v1_1154(integer) from public,anon,authenticated;
grant execute on function public.network_ads_pool_tick_v1_1154(integer) to service_role;
CREATE OR REPLACE FUNCTION public.network_ads_pool_admin_summary_v1_1154(p_actor uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare v_policy record; v_rows jsonb;
begin
 if not exists(select 1 from public.platform_admins a where a.user_id=p_actor
    and a.active and a.admin_role in ('superadmin','finance')) then
    raise exception 'ADS_POOL_ADMIN_DENIED' using errcode='42501';
 end if;
 select * into strict v_policy from public.network_ads_pool_policy_v1_1154 where singleton;
 select coalesce(jsonb_agg(jsonb_build_object(
     'kind',kind,'receipts',receipts,'poolMicrocents',total,
     'pendingMicrocents',pending,'validatedMicrocents',eligible,
     'reversedMicrocents',reversed,'unallocatedMicrocents',unallocated,
     'heldForReview',held_count,'heldMicrocents',held_amount
   ) order by kind),'[]'::jsonb) into v_rows
 from (
  select kind,count(*) receipts,sum(pool_microcents) total,
   coalesce(sum(pool_microcents) filter(where state='pending'),0) pending,
   coalesce(sum(pool_microcents) filter(where state='eligible'),0) eligible,
   coalesce(sum(pool_microcents) filter(where state='reversed'),0) reversed,
   coalesce(sum(pool_microcents) filter(where state='unallocated'),0) unallocated,
   count(*) filter(where state='pending' and ads_hold_reason='FINANCIAL_REVIEW') held_count,
   coalesce(sum(pool_microcents) filter(where state='pending' and ads_hold_reason='FINANCIAL_REVIEW'),0) held_amount
   from public.network_fee_package_sources_v1_1030
   where kind in ('ads_verified_view','ads_fixed_campaign') group by kind
 ) x;
 return jsonb_build_object('source','network_ads_pool_admin_v1_1154',
  'readOnly',true,'accrualEnabled',v_policy.accrual_enabled,
  'poolBps',1000,'payoutsEnabled',false,'fundedBy','verified_ad_revenue',
  'requiresTermsApproval',(v_policy.redemption_terms_approved_at is null),
  'redemptionTermsApproved',v_policy.redemption_terms_approved_at is not null,
  'termsReference',v_policy.redemption_terms_reference,'sources',v_rows);
end $function$
;
revoke all on function public.network_ads_pool_admin_summary_v1_1154(uuid) from public,anon,authenticated;
grant execute on function public.network_ads_pool_admin_summary_v1_1154(uuid) to service_role;
commit;