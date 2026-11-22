-- TAMÃO V1.1154 — incluir PUBLICIDADE no mesmo fundo de 10% da Rede.
-- Receitas de duas modalidades: views cobradas por créditos pagos e campanhas
-- por período entregues e conciliadas. Recargas isoladas não são receita
-- realizada, e anúncios institucionais gratuitos nunca entram no fundo.
-- Valores em microcentavos (1 centavo = 1.000.000 microcentavos): 2 centavos
-- cobrados em uma view geram 200.000 microcentavos = 0,2 centavo.
-- Nenhuma movimentação externa, Pix, saque ou comissão direta é criada.
begin;

create table public.network_ads_pool_policy_v1_1154 (
 singleton boolean primary key default true check(singleton),
 accrual_enabled boolean not null default true,
 effective_after timestamptz not null default clock_timestamp(),
 pool_bps integer not null default 1000 check(pool_bps=1000),
 maturity_days integer not null default 7 check(maturity_days between 7 and 60),
 payouts_enabled boolean not null default false check(payouts_enabled=false),
 updated_at timestamptz not null default clock_timestamp()
);
insert into public.network_ads_pool_policy_v1_1154(singleton) values(true);
alter table public.network_ads_pool_policy_v1_1154 enable row level security;
revoke all on public.network_ads_pool_policy_v1_1154 from public,anon,authenticated;
grant select on public.network_ads_pool_policy_v1_1154 to service_role;

-- Reutiliza fontes e prêmios do fundo EXISTENTE: mesmas visitas verificadas,
-- extrato, balanços e reservas sem criar um segundo saldo de Rede.
-- fee_credit_cents é coluna histórica: nas fontes publicitárias contém
-- a receita bruta já realizada, NUNCA crédito concedido ao anunciante.
alter table public.network_fee_package_sources_v1_1030
 drop constraint network_fee_package_sources_v1_1030_kind_check;
alter table public.network_fee_package_sources_v1_1030
 add constraint network_fee_package_sources_v1_1030_kind_check
 check (kind in ('merchant_prepaid_fee','mobility_prepaid_fee','ads_verified_view','ads_fixed_campaign'));
alter table public.network_fee_package_sources_v1_1030
 drop constraint network_fee_package_sources_v1_1030_check1;
alter table public.network_fee_package_sources_v1_1030
 add constraint network_fee_package_sources_v1_1030_check1
 check ((kind='merchant_prepaid_fee' and merchant_id is not null and credit_entry_id is not null)
     or (kind='mobility_prepaid_fee' and merchant_id is null and credit_entry_id is null)
     or (kind in ('ads_verified_view','ads_fixed_campaign')
         and buyer_user_id is not null and merchant_id is null and credit_entry_id is null
         and referrer_user_id is null));
alter table public.network_fee_package_sources_v1_1030
 add column ads_reviewed_at timestamptz;
create index network_ads_pool_review_v1_1154_idx
 on public.network_fee_package_sources_v1_1030(ads_reviewed_at asc nulls first,recorded_at)
 where kind in ('ads_verified_view','ads_fixed_campaign')
   and state in ('pending','eligible');

-- Fundo de pacotes continua na sua própria política; nunca confundir view
-- com uma fatura de mobilidade nem bloquear a maturação dos pacotes legados.
CREATE OR REPLACE FUNCTION public.network_fee_package_tick_v1_1030(p_limit integer DEFAULT 25)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
 v_config public.network_fee_package_policy_v1_1030%rowtype;
 v_src record; v_old record; v_grant record;
 v_closed timestamptz; v_visit_users uuid[];
 v_count integer;v_i integer;v_user uuid;
 v_pool bigint;v_bonus bigint;v_shared bigint;v_each bigint;v_rem bigint;v_share bigint;
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
   where s.state in ('pending','eligible') and s.kind in ('merchant_prepaid_fee','mobility_prepaid_fee') order by s.recorded_at limit p_limit
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
       -- The purchaser's entire merchant staff is not a disinterested
       -- community member for its OWN fee-credit package.
       and not exists(select 1 from public.merchant_members own
         where own.merchant_id=v_src.merchant_id and own.user_id=e.user_id
           and own.active)
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
       v_share:=v_each;
       if v_i<=v_rem then v_share:=v_share+1;end if;
       if v_share=0 and v_user is distinct from v_inviter then continue;end if;
       insert into public.network_fee_package_awards_v1_1030(
        kind,source_id,user_id,equal_microcents,inviter_microcents)
       values(v_src.kind,v_src.source_id,v_user,
         v_share,case when v_user=v_inviter then v_bonus else 0 end);
       v_award_count:=v_award_count+1;
     end loop;
   end if;
 end loop;
 return jsonb_build_object('source','network_tick_v1_1030',
   'accrualEnabled',true,'recordedSources',v_source_count,
   'recordedAwards',v_award_count,'matured',v_matured,'reversed',v_reversed,
   'payoutsExecuted',0);
end $function$
;

revoke all on function public.network_fee_package_tick_v1_1030(integer)
 from public,anon,authenticated;
grant execute on function public.network_fee_package_tick_v1_1030(integer)
 to service_role;

create or replace function public.network_ads_pool_tick_v1_1154(p_limit integer default 250)
 returns jsonb language plpgsql security definer set search_path=pg_catalog as $ads$
declare
 v_policy public.network_ads_pool_policy_v1_1154%rowtype;
 v_old record;v_src record;v_members uuid[];
 v_close timestamptz;v_pool bigint;v_each bigint;v_rem bigint;v_share bigint;
 v_safe boolean;v_reversed boolean;v_count integer;v_i integer;
 v_new integer:=0;v_awards integer:=0;v_matured integer:=0;v_revoked integer:=0;
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
       ads_reviewed_at=clock_timestamp()
      where kind=v_old.kind and source_id=v_old.source_id;
    v_revoked:=v_revoked+1;
  elsif v_safe and v_old.state='pending'
       and clock_timestamp()>=v_old.closed_at+make_interval(days=>v_policy.maturity_days) then
    update public.network_fee_package_sources_v1_1030
      set state='eligible',matured_at=clock_timestamp(),ads_reviewed_at=clock_timestamp()
      where kind=v_old.kind and source_id=v_old.source_id;
    v_matured:=v_matured+1;
  else
    update public.network_fee_package_sources_v1_1030
      set ads_reviewed_at=clock_timestamp()
      where kind=v_old.kind and source_id=v_old.source_id;
  end if;
 end loop;

 if not v_policy.accrual_enabled then
   return jsonb_build_object('source','network_ads_pool_v1_1154',
    'accrualEnabled',false,'recordedSources',0,'recordedAwards',0,
    'matured',v_matured,'reversed',v_revoked,'payoutsExecuted',0);
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
   'payoutsExecuted',0);
end $ads$;

revoke all on function public.network_ads_pool_tick_v1_1154(integer)
 from public,anon,authenticated;
grant execute on function public.network_ads_pool_tick_v1_1154(integer) to service_role;

-- Admin read-only: the two Ads sources are reported separately; nothing is
-- mistaken for wallet money, cashback, or an approved external withdrawal.
create function public.network_ads_pool_admin_summary_v1_1154(p_actor uuid)
 returns jsonb language plpgsql stable security definer
 set search_path=pg_catalog as $summary$
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
     'reversedMicrocents',reversed,'unallocatedMicrocents',unallocated
   ) order by kind),'[]'::jsonb) into v_rows
 from (
  select kind,count(*) receipts,sum(pool_microcents) total,
   coalesce(sum(pool_microcents) filter(where state='pending'),0) pending,
   coalesce(sum(pool_microcents) filter(where state='eligible'),0) eligible,
   coalesce(sum(pool_microcents) filter(where state='reversed'),0) reversed,
   coalesce(sum(pool_microcents) filter(where state='unallocated'),0) unallocated
   from public.network_fee_package_sources_v1_1030
   where kind in ('ads_verified_view','ads_fixed_campaign') group by kind
 ) x;
 return jsonb_build_object('source','network_ads_pool_admin_v1_1154',
  'readOnly',true,'accrualEnabled',v_policy.accrual_enabled,
  'poolBps',1000,'payoutsEnabled',false,'fundedBy','verified_ad_revenue',
  'requiresTermsApproval',true,'sources',v_rows);
end $summary$;
revoke all on function public.network_ads_pool_admin_summary_v1_1154(uuid)
 from public,anon,authenticated;
grant execute on function public.network_ads_pool_admin_summary_v1_1154(uuid)
 to service_role;

-- Extrato existente e indicadores existentes passam a reconhecer publicidade
-- na MESMA conta da Rede. A semântica de saldo disponível não é alterada.
CREATE OR REPLACE FUNCTION public.network_member_benefit_statement_v1_1045(p_user uuid, p_category text DEFAULT 'all'::text, p_page integer DEFAULT 1, p_limit integer DEFAULT 12)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare
 v_items jsonb:='[]'::jsonb;v_has_more boolean:=false;
begin
 if p_user is null or not exists(select 1 from auth.users u
      where u.id=p_user and u.deleted_at is null) then
   raise exception 'BENEFIT_STATEMENT_INVALID_USER' using errcode='22023';
 end if;
 if p_category is null or p_category not in ('all','rede','cashback','clube')
   or p_page is null or p_page<1 or p_page>100
   or p_limit is null or p_limit<1 or p_limit>25 then
   raise exception 'BENEFIT_STATEMENT_INVALID_PAGE' using errcode='22023';
 end if;

 with events as (
  -- Wallet is already authoritative. Its negative entries are real debits,
  -- not new positive earnings; pending->available are two separate movements.
  select 'wallet:'||w.id::text as "eventId",
   case when w.bucket='cashback' then 'cashback' else 'rede' end as category,
   'wallet'::text as money_type,
   case w.entry_type
    when 'cashback_seed' then 'Crédito de boas-vindas'
    when 'cashback_reserve' then 'Cashback reservado'
    when 'cashback_release' then 'Cashback devolvido'
    when 'cashback_earn' then 'Cashback da sua compra'
    when 'cashback_reversal' then 'Cashback estornado'
    when 'referral_pending' then 'Indicação em validação'
    when 'referral_pending_release' then 'Comissão saiu da validação'
    when 'referral_available' then 'Comissão liberada'
    else 'Comissão revertida' end as title,
   case when w.bucket='cashback' then 'Clube TAMÃO'
     else 'Indicação por compras qualificadas' end as origin,
   case w.entry_type
    when 'cashback_seed' then 'Crédito promocional conforme as regras da campanha.'
    when 'cashback_reserve' then 'Valor reservado para uma compra; não é uma nova cobrança.'
    when 'cashback_release' then 'Reserva desfeita e crédito devolvido.'
    when 'cashback_earn' then 'Benefício de uma compra concluída.'
    when 'cashback_reversal' then 'Ajuste devido à reversão de uma compra.'
    when 'referral_pending' then 'Compra indicada atribuída, aguardando conferência.'
    when 'referral_pending_release' then 'Transferência contábil entre saldos; não é um novo ganho.'
    when 'referral_available' then 'Comissão conferida, sujeita às regras de retirada.'
    else 'Correção da comissão após revisão ou estorno.' end as detail,
   case w.entry_type
    when 'cashback_reserve' then 'reserved'
    when 'cashback_reversal' then 'reversed'
    when 'referral_reversal' then 'reversed'
    when 'referral_pending_release' then 'moved'
    when 'referral_pending' then 'pending'
    else 'recorded' end as status,
   w.amount_cents::bigint as "amountCents",
   (w.amount_cents::bigint*1000000) as "amountMicrocents",
   w.created_at as "occurredAt",
   'BRL'::text as unit
  from public.wallet_entries w where w.user_id=p_user

  union all
  -- Shared 10% pool is recorded in microcents and may be sub-cent.
  select 'pool:'||a.kind||':'||a.source_id::text||':shared',
   'rede','network',
   'Sua participação no fundo',
   case a.kind when 'mobility_prepaid_fee' then 'Pacotes Moto/Carro'
     when 'ads_verified_view' then 'Publicidade por visualização'
     when 'ads_fixed_campaign' then 'Publicidade por período'
     else 'Pacotes de revendas' end,
   'Participação coletiva de receita comercial validada, apurada em frações de centavo; não é cashback nem saldo para saque imediato.',
   case s.state when 'eligible' then 'validated'
      when 'reversed' then 'reversed' else 'pending' end,
   floor(a.equal_microcents::numeric/1000000)::bigint,
   a.equal_microcents,a.created_at,'BRL'
  from public.network_fee_package_awards_v1_1030 a
  join public.network_fee_package_sources_v1_1030 s using(kind,source_id)
  where a.user_id=p_user and a.equal_microcents>0
  union all
  select 'pool:'||a.kind||':'||a.source_id::text||':inviter',
   'rede','network','Indicação de revenda reconhecida',
   'Pacote de taxas da revenda',
   'Parcela de indicação já incluída nos 10% do fundo, não somada novamente.',
   case s.state when 'eligible' then 'validated'
      when 'reversed' then 'reversed' else 'pending' end,
   floor(a.inviter_microcents::numeric/1000000)::bigint,
   a.inviter_microcents,a.created_at,'BRL'
  from public.network_fee_package_awards_v1_1030 a
  join public.network_fee_package_sources_v1_1030 s using(kind,source_id)
  where a.user_id=p_user and a.inviter_microcents>0

  union all
  select 'ad:'||a.campaign_id::text,'rede','network',
   'Indicação de anunciante','Publicidade TAMÃO',
   'Bônus da primeira campanha paga, validado mas ainda não disponível para saque.',
   case a.status when 'reversed' then 'reversed' else 'validated' end,
   a.bonus_cents,a.bonus_cents*1000000,a.recorded_at,'BRL'
  from public.network_module_ads_bonus_awards_v1_1041 a
  where a.inviter_user_id=p_user

  union all
  select 'direct:'||a.module||':'||a.source_id::text,'rede','network',
   case a.module when 'club' then 'Indicação de pacote do Clube'
     else 'Indicação de motorista' end,
   case a.module when 'club' then 'Clube financiado por parceiro'
     else 'Pacote Moto/Carro' end,
   'Bônus direto sobre receita líquida verificada; não está disponível para saque.',
   case a.status when 'reversed' then 'reversed' else 'validated' end,
   a.bonus_cents,a.bonus_cents*1000000,a.recorded_at,'BRL'
  from public.network_direct_module_awards_v1_1044 a
  where a.inviter_user_id=p_user

  union all
  -- Seasonal commission is a separately budget-capped marketing expense.
  -- It is NOT a withdrawal balance and is never added to the base commission.
  select 'celebra:'||a.campaign_key||':'||a.origin_id::text,
   'rede','network','Bônus especial TAMÃO Celebra',
   c.title,
   'Recompensa extra da ocasião, sobre receita líquida comprovada. Ainda sem saque.',
   case a.status when 'reversed' then 'reversed' else 'validated' end,
   a.bonus_cents,a.bonus_cents*1000000,a.recorded_at,'BRL'
  from public.network_celebra_awards_v1_1046 a
  join public.network_celebra_campaigns_v1_1046 c on c.campaign_key=a.campaign_key
  where a.inviter_user_id=p_user

  union all
  -- Coupon face value is a discount instrument, NEVER a cash credit.
  select 'voucher:'||v.id::text,'clube','discount',
   case when v.status='redeemed' then 'Cupom utilizado'
     when v.status='void' or i.status<>'paid' then 'Cupom cancelado'
     when v.expires_at<=clock_timestamp() then 'Cupom vencido'
     when v.status='reserved' then 'Cupom reservado'
     when v.status='review_required' then 'Cupom em revisão'
     else 'Cupom recebido' end,
   'Cupons do Clube TAMÃO',
   'Valor de desconto condicionado às regras do cupom; não é dinheiro nem saldo para saque.',
   case when v.status='redeemed' then 'used'
     when v.status='void' or i.status<>'paid' then 'cancelled'
     when v.expires_at<=clock_timestamp() then 'expired'
     when v.status='reserved' then 'reserved'
     when v.status='review_required' then 'review'
     else 'available' end,
   v.face_cents::bigint,v.face_cents::bigint*1000000,v.created_at,'BRL'
  from public.clube_coupon_paid_issuances v
  join public.clube_coupon_paid_invoices i on i.id=v.invoice_id
  where v.customer_user_id=p_user

  union all
  -- These are requests for payments from the existing network 10% fund.
  -- Show a bank payment only after immutable receipt evidence exists.
  select 'withdrawal:'||p.id::text,'rede','transfer',
   case p.state when 'paid' then 'Saque pago'
     when 'approved' then 'Saque aprovado'
     when 'cancelled' then 'Saque cancelado'
     when 'review' then 'Saque em conferência'
     else 'Saque solicitado' end,
   'Retirada do fundo da Rede',
   case when p.state='paid' and p.bank_receipt_sha256 is not null
      and p.bank_reference is not null then 'Pagamento conferido com comprovante.'
     when p.state='approved' then 'Pagamento manual até três dias após aprovação.'
     else 'Solicitação não representa pagamento realizado.' end,
   case p.state when 'paid' then 'paid' when 'approved' then 'approved'
     when 'cancelled' then 'cancelled' when 'review' then 'review'
     else 'pending' end,
   p.amount_cents,p.amount_cents*1000000,p.requested_at,'BRL'
  from public.network_manual_payout_requests_v1_1034 p
  where p.user_id=p_user
 ),
 ordered as (
   select e.*,row_number() over(order by e."occurredAt" desc,e."eventId" desc) rn
   from events e where p_category='all' or e.category=p_category
 ),
 page_rows as (
   select * from ordered
   where rn between ((p_page-1)*p_limit+1) and (p_page*p_limit+1)
 )
 select
   coalesce(jsonb_agg(to_jsonb(p)-'rn' order by p.rn)
      filter(where p.rn<=p_page*p_limit),'[]'::jsonb),
   coalesce(bool_or(p.rn=p_page*p_limit+1),false)
 into v_items,v_has_more
 from page_rows p;

 return jsonb_build_object(
   'source','network_member_statement_v1_1045',
   'readOnly',true,'moneyMoved',false,
   'category',p_category,'page',p_page,'pageSize',p_limit,
   'hasMore',v_has_more,'items',v_items);
end $function$
;
revoke all on function public.network_member_benefit_statement_v1_1045(uuid,text,integer,integer)
 from public,anon,authenticated;
grant execute on function public.network_member_benefit_statement_v1_1045(uuid,text,integer,integer)
 to service_role;

CREATE OR REPLACE FUNCTION public.network_user_fee_package_summary_v1_1030(p_user uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare v_pending bigint;v_matured bigint;v_reversed bigint;v_sources bigint;
 v_activity timestamptz;v_policy record;
begin
 select * into v_policy from public.network_fee_package_policy_v1_1030 where singleton;
 select coalesce(sum(a.equal_microcents+a.inviter_microcents)
   filter(where s.state='pending'),0),
   coalesce(sum(a.equal_microcents+a.inviter_microcents)
   filter(where s.state='eligible'),0),
   coalesce(sum(a.equal_microcents+a.inviter_microcents)
   filter(where s.state='reversed'),0),
   count(*)
 into v_pending,v_matured,v_reversed,v_sources
 from public.network_fee_package_awards_v1_1030 a
 join public.network_fee_package_sources_v1_1030 s using(kind,source_id)
 where a.user_id=p_user;
 select max(last_visit_at) into v_activity
 from public.network_member_visits_v1_1030 where user_id=p_user;
 return jsonb_build_object('source','network_fee_package_user_v1_1030',
  'readOnly',true,'payoutsEnabled',false,
  'accrualEnabled',coalesce(v_policy.accrual_enabled,false),
  'adsAccrualEnabled',(select accrual_enabled from public.network_ads_pool_policy_v1_1154 where singleton),
  'pendingMicrocents',v_pending,'validatedMicrocents',v_matured,
  'reversedMicrocents',v_reversed,
  'pendingCents',floor(v_pending::numeric/1000000)::bigint,
  'validatedCents',floor(v_matured::numeric/1000000)::bigint,
  'awardSources',v_sources,'lastVerifiedVisitAt',v_activity);
end $function$
;
revoke all on function public.network_user_fee_package_summary_v1_1030(uuid)
 from public,anon,authenticated;
grant execute on function public.network_user_fee_package_summary_v1_1030(uuid)
 to service_role;

CREATE OR REPLACE FUNCTION public.network_fee_package_admin_summary_v1_1030(p_actor uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare v_total bigint;v_pending bigint;v_eligible bigint;v_reversed bigint;
 v_unallocated bigint;v_sources bigint;v_members bigint;v_policy record;
begin
 if not exists(select 1 from public.platform_admins a where a.user_id=p_actor
   and a.active and a.admin_role in ('superadmin','finance'))
 then raise exception 'NETWORK_ADMIN_DENIED' using errcode='42501';end if;
 select * into v_policy from public.network_fee_package_policy_v1_1030 where singleton;
 select count(*),coalesce(sum(pool_microcents),0),
   coalesce(sum(pool_microcents) filter(where state='pending'),0),
   coalesce(sum(pool_microcents) filter(where state='eligible'),0),
   coalesce(sum(pool_microcents) filter(where state='reversed'),0),
   coalesce(sum(pool_microcents) filter(where state='unallocated'),0)
 into v_sources,v_total,v_pending,v_eligible,v_reversed,v_unallocated
 from public.network_fee_package_sources_v1_1030;
 select count(distinct user_id) into v_members from public.network_member_visits_v1_1030
  where last_visit_at>clock_timestamp()-interval '24 hours';
 return jsonb_build_object('source','network_fee_package_admin_v1_1030',
  'readOnly',true,'payoutsEnabled',false,
  'accrualEnabled',coalesce(v_policy.accrual_enabled,false),
  'poolBps',1000,'sourceCount',v_sources,'membersActive24h',v_members,
  'totalPoolMicrocents',v_total,
  'pendingMicrocents',v_pending,'validatedMicrocents',v_eligible,
  'reversedMicrocents',v_reversed,'unallocatedMicrocents',v_unallocated,
  'effectiveAfter',v_policy.effective_after,
  'requiresTermsApproval',v_policy.terms_approved_at is null,'adsAccrualEnabled',(select accrual_enabled from public.network_ads_pool_policy_v1_1154 where singleton));
end $function$
;
revoke all on function public.network_fee_package_admin_summary_v1_1030(uuid)
 from public,anon,authenticated;
grant execute on function public.network_fee_package_admin_summary_v1_1030(uuid)
 to service_role;

-- Scheduler privado: não libera Pix, dinheiro, saque nem saldo transferível.
do $schedule$
begin
 if exists(select 1 from pg_extension where extname='pg_cron') then
  perform cron.schedule('tamao-network-ads-pool-v1-1154','*/30 * * * *',
   'select public.network_ads_pool_tick_v1_1154()');
 end if;
end $schedule$;
commit;
