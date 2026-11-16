-- TAMÃO #493 — canonical accrual from reconciled NET fee-prepaid packages.
-- Design: capture at daily close using authenticated activity witnessed at the
-- time; reserve the full 10% pool, and mature only after FULL fee-credit use,
-- 7+ days, intact PSP status and no adjustments/refunds. No Pix transfers.
begin;

create function public.network_fee_package_set_enabled_v1_1030(
 p_actor uuid,p_enabled boolean,p_terms_reference text default null
) returns jsonb language plpgsql volatile security definer
set search_path=pg_catalog as $fn$
declare v_terms text:=nullif(btrim(coalesce(p_terms_reference,'')),'');
begin
 if not exists(select 1 from public.platform_admins
   where user_id=p_actor and active and admin_role='superadmin')
 then raise exception 'NETWORK_POLICY_OWNER_ONLY' using errcode='42501';end if;
 if p_enabled is null then raise exception 'NETWORK_POLICY_INVALID';end if;
 if p_enabled and (v_terms is null or length(v_terms) not between 12 and 160
    or v_terms ~ '[<>]')
 then raise exception 'NETWORK_TERMS_REFERENCE_REQUIRED' using errcode='22023';end if;
 perform 1 from public.network_fee_package_policy_v1_1030 where singleton for update;
 if p_enabled then
  update public.network_fee_package_policy_v1_1030
  set accrual_enabled=true,effective_after=clock_timestamp(),
    terms_reference=v_terms,terms_approved_at=clock_timestamp(),
    updated_at=clock_timestamp() where singleton and not accrual_enabled;
 else
  update public.network_fee_package_policy_v1_1030
   set accrual_enabled=false,updated_at=clock_timestamp()
   where singleton and accrual_enabled;
 end if;
 return jsonb_build_object('source','network_policy_v1_1030',
   'accrualEnabled',(select accrual_enabled from public.network_fee_package_policy_v1_1030 where singleton),
   'payoutsEnabled',false,'moneyMoved',false);
end $fn$;
revoke all on function public.network_fee_package_set_enabled_v1_1030(uuid,boolean,text)
 from public,anon,authenticated;
grant execute on function public.network_fee_package_set_enabled_v1_1030(uuid,boolean,text)
 to service_role;

create function public.network_fee_package_tick_v1_1030(p_limit integer default 25)
returns jsonb language plpgsql volatile security definer
set search_path=pg_catalog as $fn$
declare
 v_config public.network_fee_package_policy_v1_1030%rowtype;
 v_src record; v_old record; v_grant record;
 v_closed timestamptz; v_visit_users uuid[];
 v_count integer;v_i integer;v_user uuid;
 v_pool bigint;v_bonus bigint;v_shared bigint;v_each bigint;v_rem bigint;
 v_inviter uuid;v_paid record;
 v_source_count integer:=0;v_award_count integer:=0;
 v_matured integer:=0;v_reversed integer:=0;
 v_prior_grants bigint;v_consumed bigint;v_maturity_ready boolean;
begin
 if p_limit is null or p_limit<1 or p_limit>100
 then raise exception 'NETWORK_BATCH_LIMIT_INVALID' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('tamao-network-fee-package-close-1030',0));
 select * into v_config from public.network_fee_package_policy_v1_1030 where singleton for update;
 if not found then raise exception 'NETWORK_POLICY_MISSING';end if;

 -- Existing liabilities are rechecked even when new accruals are disabled.
 -- A refund revokes the whole award and no cash ever leaves this mechanism.
 for v_old in select s.* from public.network_fee_package_sources_v1_1030 s
   where s.state in ('pending','eligible') order by s.recorded_at limit p_limit
 loop
   v_maturity_ready:=false;
   if v_old.kind='merchant_prepaid_fee' then
     select c.status as charge_status,r.status as request_status,
       exists(select 1 from public.merchant_billing_payment_refunds f
          where f.payment_request_id=c.payment_request_id
            and f.amount_cents>0 and f.status<>'ignored_unrelated') as refunded
     into v_paid from public.merchant_billing_provider_charges c
     join public.merchant_billing_payment_requests r on r.id=c.payment_request_id
     where c.id=v_old.source_id;
     if not found or v_paid.charge_status<>'completed' or
         v_paid.request_status<>'approved' or v_paid.refunded then
       update public.network_fee_package_sources_v1_1030
       set state='reversed',reversed_at=clock_timestamp(),matured_at=null
       where kind=v_old.kind and source_id=v_old.source_id and state<>'reversed';
       v_reversed:=v_reversed+1;continue;
     end if;
     select l.id,l.created_at,l.amount_cents into v_grant
     from public.merchant_fee_credit_ledger l
     where l.id=v_old.credit_entry_id and l.entry_type='package_credit'
       and l.amount_cents=v_old.fee_credit_cents
       and l.merchant_id=v_old.merchant_id;
     if not found then raise exception 'NETWORK_CREDIT_ORIGIN_CHANGED';end if;
     -- Conservative FIFO accounting: all prior grant credit must be spent.
     -- Manual adjustments make attribution ambiguous; withhold maturity.
     select coalesce(sum(l.amount_cents),0) into v_prior_grants
     from public.merchant_fee_credit_ledger l
     where l.merchant_id=v_old.merchant_id and l.entry_type='package_credit'
       and (l.created_at,l.id)<=(v_grant.created_at,v_grant.id);
     select coalesce(-sum(l.amount_cents),0) into v_consumed
     from public.merchant_fee_credit_ledger l
     where l.merchant_id=v_old.merchant_id and l.entry_type='fee_consumption';
     v_maturity_ready:=(v_consumed>=v_prior_grants
       and not exists(select 1 from public.merchant_fee_credit_ledger a
         where a.merchant_id=v_old.merchant_id and a.entry_type='admin_adjustment'
           and a.created_at<=clock_timestamp()));
   else
     select i.status as invoice_status,l.funded_cents,l.spent_cents,l.reserved_cents,
       l.status as lot_status into v_paid
     from public.mobility_fee_pix_invoices_v1_837 i
     left join public.mobility_fee_prepaid_lots_v1_838 l on l.invoice_id=i.id
     where i.id=v_old.source_id;
     if not found or v_paid.invoice_status<>'paid' or
       v_paid.lot_status<>'active' then
       update public.network_fee_package_sources_v1_1030
       set state='reversed',reversed_at=clock_timestamp(),matured_at=null
       where kind=v_old.kind and source_id=v_old.source_id and state<>'reversed';
       v_reversed:=v_reversed+1;continue;
     end if;
     v_maturity_ready:=(v_paid.spent_cents=v_paid.funded_cents
       and v_paid.reserved_cents=0);
   end if;
   if exists(select 1 from public.platform_receipt_net_observations n
     where n.kind=case when v_old.kind='merchant_prepaid_fee' then 'billing' else 'mobility' end
      and n.resource_id=v_old.source_id
      and n.status in ('reversed','requires_review'))
   then
     update public.network_fee_package_sources_v1_1030
     set state='reversed',reversed_at=clock_timestamp(),matured_at=null
     where kind=v_old.kind and source_id=v_old.source_id and state<>'reversed';
     v_reversed:=v_reversed+1;continue;
   end if;
   if v_old.state='pending' and v_maturity_ready
     and clock_timestamp()>=v_old.attributed_at + make_interval(days=>v_config.maturity_days)
   then
     update public.network_fee_package_sources_v1_1030
      set state='eligible',matured_at=clock_timestamp()
      where kind=v_old.kind and source_id=v_old.source_id and state='pending';
     v_matured:=v_matured+1;
   end if;
 end loop;
 if not v_config.accrual_enabled then
   return jsonb_build_object('source','network_tick_v1_1030',
     'accrualEnabled',false,'recordedSources',0,'recordedAwards',0,
     'matured',v_matured,'reversed',v_reversed,'payoutsExecuted',0);
 end if;

 for v_src in
   select * from (
    select 'merchant_prepaid_fee'::text as kind,c.id as source_id,
      c.merchant_id,r.requested_by as buyer_user_id,
      c.amount_cents as gross_cents,a.net_cents,
      r.credit_grant_cents_snapshot as fee_credit_cents,
      g.id as credit_entry_id,c.completed_at as paid_at,
      a.evidence_reference as receipt_reference
    from public.merchant_billing_provider_charges c
    join public.merchant_billing_payment_requests r on r.id=c.payment_request_id
    join public.merchant_billing_plans p on p.plan_key=r.plan_key
      and p.billing_mode='prepaid_credit'
    join public.merchant_fee_credit_ledger g
      on g.payment_request_id=r.id and g.merchant_id=c.merchant_id
      and g.entry_type='package_credit'
      and g.amount_cents=r.credit_grant_cents_snapshot
    join public.platform_receipt_net_audit a
      on a.kind='billing' and a.resource_id=c.id and a.gross_cents=c.amount_cents
    join public.platform_receipt_net_observations o
      on o.kind='billing' and o.resource_id=c.id and o.status='net_verified'
    where c.status='completed' and c.provider='mercadopago'
      and r.request_kind='package_purchase' and r.status='approved'
      and r.auto_applied=true and c.completed_at is not null
      and c.completed_at>=v_config.effective_after
      and a.release_at<=clock_timestamp()
      and not exists(select 1 from public.merchant_billing_payment_refunds f
        where f.payment_request_id=c.payment_request_id and f.amount_cents>0
          and f.status<>'ignored_unrelated')
    union all
    select 'mobility_prepaid_fee'::text,i.id,null::uuid,i.driver_id,
       i.amount_cents::bigint,a.net_cents,l.funded_cents::bigint,null::uuid,
       i.paid_at,a.evidence_reference
    from public.mobility_fee_pix_invoices_v1_837 i
    join public.mobility_fee_prepaid_lots_v1_838 l on l.invoice_id=i.id
       and l.status='active' and l.funded_cents=i.grant_cents
    join public.platform_receipt_net_audit a on a.kind='mobility'
       and a.resource_id=i.id and a.gross_cents=i.amount_cents
    join public.platform_receipt_net_observations o on o.kind='mobility'
       and o.resource_id=i.id and o.status='net_verified'
    where i.status='paid' and i.invoice_kind='prepaid_credit'
      and i.paid_at>=v_config.effective_after and a.release_at<=clock_timestamp()
   ) q
   where q.paid_at is not null and
    ((q.paid_at at time zone 'America/Sao_Paulo')::date+1)::timestamp
      at time zone 'America/Sao_Paulo' <= clock_timestamp()
    and not exists(select 1 from public.network_fee_package_sources_v1_1030 s
     where s.kind=q.kind and s.source_id=q.source_id)
   order by q.paid_at,q.kind,q.source_id limit p_limit
 loop
   -- Internal cap to avoid BIGINT overflow; 10% is always bounded.
   if v_src.net_cents<=0 or v_src.net_cents>1000000000 or
     v_src.net_cents>v_src.gross_cents or v_src.fee_credit_cents<=0 then
     raise exception 'NETWORK_RECEIPT_ECONOMICS_INVALID';
   end if;
   v_pool:=v_src.net_cents*100000; -- exactly 10% in microcents
   v_closed:=((v_src.paid_at at time zone 'America/Sao_Paulo')::date+1)::timestamp
      at time zone 'America/Sao_Paulo';
   -- The eligibility snapshot is the previous 24h before the local daily close.
   -- The user must be a REAL, confirmed account and not a platform administrator.
   select array_agg(user_id order by user_id) into v_visit_users from (
     select distinct e.user_id from public.network_member_visits_v1_1030 e
     join auth.users u on u.id=e.user_id and u.is_anonymous=false
       and u.deleted_at is null
       and (u.email_confirmed_at is not null or u.phone_confirmed_at is not null)
       and (u.banned_until is null or u.banned_until<clock_timestamp())
     where e.last_visit_at>v_closed-interval '24 hours'
       and e.last_visit_at<=v_closed
       and e.user_id is distinct from v_src.buyer_user_id
       and not exists(select 1 from public.platform_admins z
         where z.user_id=e.user_id and z.active)
   ) eligible;
   v_count:=coalesce(array_length(v_visit_users,1),0);
   v_inviter:=null;v_bonus:=0;
   if v_count>0 and v_src.kind='merchant_prepaid_fee' then
      -- Only a first-touch CNPJ linked to a verified and approved application.
      -- A mere visitor lead does NOT create commission.
      select case when attr.inviter_kind='customer' then attr.inviter_user_id
        else (select mm.user_id from public.merchant_members mm
          where mm.merchant_id=attr.inviter_merchant_id and mm.active
            and mm.member_role='owner' order by mm.created_at,mm.user_id limit 1)
        end into v_inviter
      from public.merchants m
      join public.merchant_applications app
        on app.cnpj=m.cnpj and app.status='approved'
      join public.growth_merchant_application_attributions_v1_229 attr
        on attr.application_id=app.id and attr.cnpj=m.cnpj
      where m.id=v_src.merchant_id
        and attr.inviter_kind in ('customer','merchant')
        and exists(select 1 from public.growth_referral_reviews_v1_230 r
          where r.application_id=app.id and r.decision='verified_identity'
            and r.evidence_cnpj_match and r.evidence_owner_match
            and r.evidence_inviter_valid)
      order by app.created_at asc limit 1;
      if v_inviter is not null and v_inviter=any(v_visit_users)
        and v_inviter is distinct from v_src.buyer_user_id
        and not exists(select 1 from public.merchant_members m
          where m.merchant_id=v_src.merchant_id and m.user_id=v_inviter and m.active)
      then v_bonus:=floor(v_pool::numeric*2000/10000)::bigint;
      else v_inviter:=null;end if;
   end if;
   insert into public.network_fee_package_sources_v1_1030(
    kind,source_id,buyer_user_id,merchant_id,credit_entry_id,
    gross_cents,net_cents,fee_credit_cents,pool_microcents,
    attributed_at,closed_at,receipt_reference,state,referrer_user_id)
   values(v_src.kind,v_src.source_id,v_src.buyer_user_id,v_src.merchant_id,
      v_src.credit_entry_id,v_src.gross_cents,v_src.net_cents,
      v_src.fee_credit_cents,v_pool,v_src.paid_at,v_closed,
      v_src.receipt_reference,case when v_count>0 then 'pending' else 'unallocated' end,
      v_inviter)
   on conflict(kind,source_id) do nothing;
   if not found then continue;end if;
   v_source_count:=v_source_count+1;
   if v_count>0 then
     v_shared:=v_pool-v_bonus;
     v_each:=v_shared/v_count;
     v_rem:=mod(v_shared,v_count);
     for v_i in 1..v_count loop
       v_user:=v_visit_users[v_i];
       if v_each+case when v_i<=v_rem then 1 else 0 end
          +case when v_user=v_inviter then v_bonus else 0 end=0 then continue;end if;
       insert into public.network_fee_package_awards_v1_1030(
        kind,source_id,user_id,equal_microcents,inviter_microcents)
       values(v_src.kind,v_src.source_id,v_user,
         v_each+case when v_i<=v_rem then 1 else 0 end,
         case when v_user=v_inviter then v_bonus else 0 end);
       v_award_count:=v_award_count+1;
     end loop;
   end if;
 end loop;
 return jsonb_build_object('source','network_tick_v1_1030',
   'accrualEnabled',true,'recordedSources',v_source_count,
   'recordedAwards',v_award_count,'matured',v_matured,'reversed',v_reversed,
   'payoutsExecuted',0);
end $fn$;
revoke all on function public.network_fee_package_tick_v1_1030(integer)
 from public,anon,authenticated;
grant execute on function public.network_fee_package_tick_v1_1030(integer)
 to service_role;

-- A complete sum must be conserved per source; no duplicate or overpayment.
create function public.network_fee_package_conservation_v1_1030(p_actor uuid)
returns jsonb language plpgsql stable security definer
set search_path=pg_catalog as $fn$
declare v_errors bigint;v_awards bigint;v_sources bigint;
begin
 if not exists(select 1 from public.platform_admins
  where user_id=p_actor and active and admin_role in ('superadmin','finance'))
 then raise exception 'NETWORK_AUDIT_DENIED' using errcode='42501';end if;
 with x as (
  select s.kind,s.source_id,s.state,s.pool_microcents,
   coalesce(sum(a.equal_microcents+a.inviter_microcents),0) as total,
   coalesce(sum(a.inviter_microcents),0) as bonus
  from public.network_fee_package_sources_v1_1030 s
  left join public.network_fee_package_awards_v1_1030 a using(kind,source_id)
  group by s.kind,s.source_id,s.state,s.pool_microcents
 )
 select count(*),count(*) filter(where state<>'unallocated' and total<>pool_microcents
      or state='unallocated' and total<>0
      or bonus>floor(pool_microcents::numeric*0.2)::bigint
      or kind='mobility_prepaid_fee' and bonus<>0)
 into v_sources,v_errors from x;
 select count(*) into v_awards from public.network_fee_package_awards_v1_1030;
 return jsonb_build_object('source','network_conservation_v1_1030',
  'readOnly',true,'sourceCount',v_sources,'awardCount',v_awards,
  'violations',v_errors,'balanced',v_errors=0,'payoutsEnabled',false);
end $fn$;
revoke all on function public.network_fee_package_conservation_v1_1030(uuid)
 from public,anon,authenticated;
grant execute on function public.network_fee_package_conservation_v1_1030(uuid)
 to service_role;

-- Schedule silently only on installations with pg_cron. The function is a
-- fail-closed no-op for new accruals until Owner approves the program terms.
do $schedule$
begin
 if exists(select 1 from pg_extension where extname='pg_cron') then
  perform cron.schedule('tamao-network-fee-packages-v1-1030',
    '*/30 * * * *','select public.network_fee_package_tick_v1_1030()');
 end if;
end $schedule$;
commit;
