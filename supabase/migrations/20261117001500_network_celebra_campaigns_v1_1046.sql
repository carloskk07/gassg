-- TAMÃO V1.1046: TAMÃO Celebra — bounded seasonal extras on verified NET.
-- No visits/cadastros produce money. Does not alter 10% shared pool or wallets.
-- The two 2026/27 offers are OFF and unfunded/unapproved by default.
begin;

create table public.network_celebra_campaigns_v1_1046 (
  campaign_key text primary key check(campaign_key in ('natal_2026','ano_novo_2027')),
  title text not null check(length(title) between 8 and 80),
  message text not null check(length(message) between 20 and 220),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  extra_bps integer not null default 100 check(extra_bps between 1 and 100),
  budget_limit_cents bigint not null default 0 check(budget_limit_cents between 0 and 10000),
  spent_cents bigint not null default 0 check(spent_cents>=0 and spent_cents<=budget_limit_cents),
  member_limit_cents integer not null default 200 check(member_limit_cents between 100 and 500),
  enabled boolean not null default false,
  authorized_at timestamptz,
  authorized_by uuid references auth.users(id) on delete restrict,
  terms_reference text,
  updated_at timestamptz not null default clock_timestamp(),
  check(ends_at>starts_at and ends_at<=starts_at+interval '16 days'),
  check(not enabled or (
    authorized_at is not null and authorized_by is not null and
    length(terms_reference) between 12 and 160 and terms_reference !~ '[<>]' and
    budget_limit_cents>=100 and budget_limit_cents<=10000))
);
insert into public.network_celebra_campaigns_v1_1046
 (campaign_key,title,message,starts_at,ends_at)
values
 ('natal_2026','Natal que aproxima',
  'Compartilhar oportunidades também é um presente. Benefício extra somente por indicação que gerar receita elegível verificada.',
  '2026-12-20 00:00:00-03','2026-12-28 00:00:00-03'),
 ('ano_novo_2027','Ano Novo, novas conexões',
  'Uma nova temporada para a Rede TAMÃO. O bônus especial depende de receita confirmada e das regras publicadas.',
  '2026-12-29 00:00:00-03','2027-01-05 00:00:00-03');

create table public.network_celebra_awards_v1_1046 (
 campaign_key text not null references public.network_celebra_campaigns_v1_1046(campaign_key),
 origin_type text not null check(origin_type in ('direct','advertising')),
 origin_id uuid not null,
 inviter_user_id uuid not null references auth.users(id) on delete restrict,
 referred_user_id uuid not null references auth.users(id) on delete restrict,
 net_cents bigint not null check(net_cents>0),
 bonus_cents bigint not null check(bonus_cents>0 and bonus_cents<=net_cents/100),
 proof_reference text not null check(length(proof_reference) between 8 and 240),
 qualified_at timestamptz not null,
 recorded_at timestamptz not null default clock_timestamp(),
 status text not null default 'validated' check(status in ('validated','reversed')),
 reversed_at timestamptz,
 primary key(campaign_key,origin_type,origin_id),
 unique(campaign_key,inviter_user_id),
 check(inviter_user_id<>referred_user_id),
 check((status='validated' and reversed_at is null) or
       (status='reversed' and reversed_at is not null))
);
create index network_celebra_awards_user_v1_1046
  on public.network_celebra_awards_v1_1046(inviter_user_id,recorded_at desc);

alter table public.network_celebra_campaigns_v1_1046 enable row level security;
alter table public.network_celebra_awards_v1_1046 enable row level security;
revoke all on public.network_celebra_campaigns_v1_1046,
 public.network_celebra_awards_v1_1046 from public,anon,authenticated,service_role;
grant select,update on public.network_celebra_campaigns_v1_1046 to service_role;
grant select,insert,update on public.network_celebra_awards_v1_1046 to service_role;

-- One explicit owner authorization per future campaign.
-- Budget is a MAXIMUM marketing expense, not a bank deposit or proof of funds.
create function public.network_celebra_set_enabled_v1_1046(
 p_actor uuid,p_key text,p_enabled boolean,p_budget_cents bigint default null,
 p_terms_reference text default null
) returns jsonb language plpgsql volatile security definer
set search_path=pg_catalog as $fn$
declare v public.network_celebra_campaigns_v1_1046%rowtype;
 v_terms text:=nullif(btrim(coalesce(p_terms_reference,'')),'');
begin
 perform public.network_payout_assert_owner_v1_1033(p_actor);
 if p_enabled is null or p_key not in ('natal_2026','ano_novo_2027') or p_key is null
 then raise exception 'CELEBRA_INVALID_POLICY' using errcode='22023';end if;
 select * into v from public.network_celebra_campaigns_v1_1046
  where campaign_key=p_key for update;
 if not found then raise exception 'CELEBRA_CAMPAIGN_MISSING' using errcode='22023';end if;
 if p_enabled then
   if v.enabled or v.authorized_at is not null
      or clock_timestamp()>=v.starts_at or
      p_budget_cents is null or p_budget_cents not between 100 and 10000 or
      v_terms is null or length(v_terms) not between 12 and 160 or v_terms ~ '[<>]'
   then raise exception 'CELEBRA_OWNER_APPROVAL_OR_FUTURE_WINDOW_REQUIRED'
      using errcode='22023';end if;
   update public.network_celebra_campaigns_v1_1046
   set enabled=true,budget_limit_cents=p_budget_cents,
      terms_reference=v_terms,authorized_at=clock_timestamp(),
      authorized_by=p_actor,updated_at=clock_timestamp()
   where campaign_key=p_key;
 else
   update public.network_celebra_campaigns_v1_1046
   set enabled=false,updated_at=clock_timestamp()
   where campaign_key=p_key;
 end if;
 return jsonb_build_object('source','network_celebra_policy_v1_1046',
  'campaignKey',p_key,'enabled',p_enabled,
  'cashPayoutsEnabled',false,'moneyMoved',false);
end $fn$;
revoke all on function public.network_celebra_set_enabled_v1_1046(uuid,text,boolean,bigint,text)
 from public,anon,authenticated;
grant execute on function public.network_celebra_set_enabled_v1_1046(uuid,text,boolean,bigint,text)
 to service_role;

-- Reversal FIRST, even after a campaign expires or is paused.
-- Optional seasonal bonus is only from a confirmed, mature, first-conversion
-- direct bonus (mobility or partner-funded club) or a verified Ads bonus.
create function public.network_celebra_refresh_v1_1046(p_inviter uuid)
returns jsonb language plpgsql volatile security definer
set search_path=pg_catalog as $fn$
declare v_campaign public.network_celebra_campaigns_v1_1046%rowtype;
 v_candidate record;v_reversal record;
 v_bonus bigint;v_inserted integer;v_added integer:=0;v_reversed integer:=0;
begin
 if p_inviter is null then raise exception 'CELEBRA_INVITER_REQUIRED' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('network-celebra:'||p_inviter::text,0));

 for v_reversal in
  update public.network_celebra_awards_v1_1046 a
  set status='reversed',reversed_at=clock_timestamp()
  where a.inviter_user_id=p_inviter and a.status='validated' and (
    (a.origin_type='direct' and not exists(
      select 1 from public.network_direct_module_awards_v1_1044 d
      where d.source_id=a.origin_id and d.inviter_user_id=p_inviter
        and d.referred_user_id=a.referred_user_id and d.net_cents=a.net_cents
        and d.proof_reference=a.proof_reference and d.status='validated'))
    or
    (a.origin_type='advertising' and not exists(
      select 1 from public.network_module_ads_bonus_awards_v1_1041 d
      where d.campaign_id=a.origin_id and d.inviter_user_id=p_inviter
        and d.referred_user_id=a.referred_user_id and d.net_cents=a.net_cents
        and d.proof_reference=a.proof_reference and d.status='validated'))
  )
  returning a.campaign_key,a.bonus_cents
 loop
  update public.network_celebra_campaigns_v1_1046
  set spent_cents=spent_cents-v_reversal.bonus_cents,
      updated_at=clock_timestamp()
  where campaign_key=v_reversal.campaign_key;
  v_reversed:=v_reversed+1;
 end loop;

 for v_campaign in
  select * from public.network_celebra_campaigns_v1_1046
  where enabled and authorized_at is not null
    and clock_timestamp()>=starts_at
    and clock_timestamp()<ends_at+interval '45 days'
    and spent_cents<budget_limit_cents
  order by starts_at,campaign_key for update
 loop
  if exists(select 1 from public.network_celebra_awards_v1_1046 a
    where a.campaign_key=v_campaign.campaign_key and a.inviter_user_id=p_inviter)
  then continue;end if;
  select * into v_candidate from (
    select 'direct'::text as origin_type,d.source_id as origin_id,
      d.inviter_user_id,d.referred_user_id,d.net_cents,d.proof_reference,
      d.qualified_at,d.recorded_at
    from public.network_direct_module_awards_v1_1044 d
    where d.inviter_user_id=p_inviter and d.status='validated'
    union all
    select 'advertising',a.campaign_id,a.inviter_user_id,
      a.referred_user_id,a.net_cents,a.proof_reference,a.approved_at,a.recorded_at
    from public.network_module_ads_bonus_awards_v1_1041 a
    where a.inviter_user_id=p_inviter and a.status='validated'
  ) x
  where x.qualified_at>=greatest(v_campaign.starts_at,v_campaign.authorized_at)
    and x.qualified_at<v_campaign.ends_at
    and x.recorded_at>=v_campaign.authorized_at
  order by x.qualified_at,x.origin_type,x.origin_id limit 1;
  if not found then continue;end if;
  v_bonus:=least(
    floor(v_candidate.net_cents::numeric*v_campaign.extra_bps/10000)::bigint,
    v_campaign.member_limit_cents::bigint);
  if v_bonus<1 or v_campaign.spent_cents+v_bonus>v_campaign.budget_limit_cents
    then continue;end if;
  insert into public.network_celebra_awards_v1_1046(
    campaign_key,origin_type,origin_id,inviter_user_id,referred_user_id,
    net_cents,bonus_cents,proof_reference,qualified_at)
  values(v_campaign.campaign_key,v_candidate.origin_type,v_candidate.origin_id,
    v_candidate.inviter_user_id,v_candidate.referred_user_id,
    v_candidate.net_cents,v_bonus,v_candidate.proof_reference,
    v_candidate.qualified_at)
  on conflict do nothing;
  get diagnostics v_inserted=row_count;
  if v_inserted=1 then
   update public.network_celebra_campaigns_v1_1046
   set spent_cents=spent_cents+v_bonus,updated_at=clock_timestamp()
   where campaign_key=v_campaign.campaign_key
     and spent_cents+v_bonus<=budget_limit_cents;
   if not found then raise exception 'CELEBRA_BUDGET_INVARIANT';end if;
   v_added:=v_added+1;
  end if;
 end loop;
 return jsonb_build_object('source','network_celebra_refresh_v1_1046',
  'created',v_added,'reversed',v_reversed,'cashPayoutsEnabled',false,'moneyMoved',false);
end $fn$;
revoke all on function public.network_celebra_refresh_v1_1046(uuid)
 from public,anon,authenticated;
grant execute on function public.network_celebra_refresh_v1_1046(uuid) to service_role;

create function public.network_celebra_user_summary_v1_1046(p_user uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $fn$
declare v_items jsonb;
begin
 if p_user is null then raise exception 'CELEBRA_USER_REQUIRED' using errcode='22023';end if;
 select coalesce(jsonb_agg(jsonb_build_object(
   'key',c.campaign_key,'title',c.title,'message',c.message,
   'startsAt',c.starts_at,'endsAt',c.ends_at,'extraBps',c.extra_bps,
   'memberLimitCents',c.member_limit_cents,
   'phase',case when clock_timestamp()<c.starts_at then 'upcoming'
                when clock_timestamp()<c.ends_at and c.spent_cents<c.budget_limit_cents
                     then 'active' else 'ended' end,
   'awards',(select count(*) from public.network_celebra_awards_v1_1046 a
             where a.campaign_key=c.campaign_key and a.inviter_user_id=p_user
               and a.status='validated'),
   'validatedCents',(select coalesce(sum(a.bonus_cents),0)
             from public.network_celebra_awards_v1_1046 a
             where a.campaign_key=c.campaign_key and a.inviter_user_id=p_user
               and a.status='validated')
 ) order by c.starts_at),'[]'::jsonb) into v_items
 from public.network_celebra_campaigns_v1_1046 c
 where c.enabled and clock_timestamp()>=c.starts_at-interval '30 days'
   and clock_timestamp()<c.ends_at+interval '45 days';
 return jsonb_build_object('source','network_celebra_user_v1_1046',
   'readOnly',true,'cashPayoutsEnabled',false,'items',v_items);
end $fn$;
revoke all on function public.network_celebra_user_summary_v1_1046(uuid)
 from public,anon,authenticated;
grant execute on function public.network_celebra_user_summary_v1_1046(uuid)
 to service_role;

create function public.network_celebra_admin_v1_1046(p_actor uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog as $fn$
declare v_items jsonb;
begin
 if not exists(select 1 from public.platform_admins
   where user_id=p_actor and active and admin_role in ('superadmin','finance'))
 then raise exception 'CELEBRA_ADMIN_DENIED' using errcode='42501';end if;
 select coalesce(jsonb_agg(jsonb_build_object(
  'key',c.campaign_key,'title',c.title,'startsAt',c.starts_at,
  'endsAt',c.ends_at,'enabled',c.enabled,'extraBps',c.extra_bps,
  'budgetLimitCents',c.budget_limit_cents,'spentCents',c.spent_cents,
  'memberLimitCents',c.member_limit_cents,
  'termsApproved',c.authorized_at is not null,
  'validatedAwards',(select count(*) from public.network_celebra_awards_v1_1046 a
     where a.campaign_key=c.campaign_key and a.status='validated'),
  'reversedAwards',(select count(*) from public.network_celebra_awards_v1_1046 a
     where a.campaign_key=c.campaign_key and a.status='reversed')
 ) order by c.starts_at),'[]'::jsonb) into v_items
 from public.network_celebra_campaigns_v1_1046 c;
 return jsonb_build_object('source','network_celebra_admin_v1_1046',
    'readOnly',true,'moneyMoved',false,'cashPayoutsEnabled',false,
    'items',v_items);
end $fn$;
revoke all on function public.network_celebra_admin_v1_1046(uuid)
 from public,anon,authenticated;
grant execute on function public.network_celebra_admin_v1_1046(uuid)
 to service_role;
commit;
