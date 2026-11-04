-- Bonus de boas-vindas TAMÃO, campanha #815.
-- Schema versionado; qualquer credito exige confirmacao e orçamento.
create table if not exists public.platform_welcome_campaign_v1_815 (
  campaign_key text primary key,
  enabled boolean not null default false,
  starts_at timestamptz,
  budget_cents integer not null check (budget_cents>=0),
  award_cents integer not null check (award_cents>0),
  max_awards integer not null check (max_awards>0),
  awarded_count integer not null default 0 check (awarded_count>=0),
  awarded_cents integer not null default 0 check (awarded_cents>=0),
  check (awarded_count<=max_awards and awarded_cents<=budget_cents)
);
alter table public.platform_welcome_campaign_v1_815 enable row level security;
revoke all on public.platform_welcome_campaign_v1_815 from anon, authenticated;
insert into public.platform_welcome_campaign_v1_815
(campaign_key,enabled,budget_cents,award_cents,max_awards)
values ('welcome_2026_815',false,10000,100,100)
on conflict (campaign_key) do nothing;
create table if not exists public.platform_welcome_grants_v1_815 (
 user_id uuid primary key,
 campaign_key text not null references public.platform_welcome_campaign_v1_815,
 amount_cents integer not null check(amount_cents>0),
 wallet_entry_id uuid not null unique references public.wallet_entries(id) on delete cascade,
 granted_at timestamptz not null default now()
);
alter table public.platform_welcome_grants_v1_815 enable row level security;
revoke all on public.platform_welcome_grants_v1_815 from anon, authenticated;

-- Only a confirmed, non-anonymous account can claim. The campaign row is
-- locked before inspecting counts, writing wallet ledger, and updating budget.
create or replace function public.claim_welcome_bonus_v1_815()
returns jsonb language plpgsql security definer
set search_path=pg_catalog
as $$
declare
 v_user uuid := auth.uid();
 v_campaign public.platform_welcome_campaign_v1_815%rowtype;
 v_auth record;
 v_entry uuid;
 v_existing boolean;
begin
 if v_user is null then
   raise exception 'AUTH_REQUIRED' using errcode='42501';
 end if;
 select * into v_campaign from public.platform_welcome_campaign_v1_815
 where campaign_key='welcome_2026_815' for update;
 if not found then return jsonb_build_object('granted',false,'reason','unavailable'); end if;
 select exists(select 1 from public.platform_welcome_grants_v1_815 where user_id=v_user)
   into v_existing;
 if v_existing then return jsonb_build_object('granted',true,'alreadyGranted',true); end if;
 if not v_campaign.enabled or v_campaign.starts_at is null or
    v_campaign.awarded_count>=v_campaign.max_awards or
    v_campaign.awarded_cents+v_campaign.award_cents>v_campaign.budget_cents then
   return jsonb_build_object('granted',false,'reason','closed');
 end if;
 select email, email_confirmed_at, is_anonymous into v_auth
 from auth.users where id=v_user;
 if not found or v_auth.is_anonymous is distinct from false or
    nullif(trim(v_auth.email),'') is null or
    v_auth.email_confirmed_at is null or
    v_auth.email_confirmed_at<v_campaign.starts_at then
   return jsonb_build_object('granted',false,'reason','ineligible');
 end if;
 insert into public.wallet_entries(user_id,order_id,bucket,entry_type,
    amount_cents,idempotency_key,metadata)
 values(v_user,null,'cashback','cashback_seed',v_campaign.award_cents,
  'welcome_2026_815:'||v_user::text,
  jsonb_build_object('source','welcome_bonus','campaign','welcome_2026_815',
                     'funding','owner_promotional_budget'))
 returning id into v_entry;
 insert into public.platform_welcome_grants_v1_815
  (user_id,campaign_key,amount_cents,wallet_entry_id)
 values(v_user,v_campaign.campaign_key,v_campaign.award_cents,v_entry);
 update public.platform_welcome_campaign_v1_815
 set awarded_count=awarded_count+1,awarded_cents=awarded_cents+v_campaign.award_cents
 where campaign_key=v_campaign.campaign_key;
 return jsonb_build_object('granted',true,'alreadyGranted',false);
end;
$$;
revoke all on function public.claim_welcome_bonus_v1_815() from public, anon;
grant execute on function public.claim_welcome_bonus_v1_815() to authenticated;

-- Public information contains only totals, never identities or wallet entries.
create or replace function public.welcome_bonus_status_v1_815()
returns jsonb language sql stable security definer
set search_path=pg_catalog
as $$
 select jsonb_build_object(
  'active',c.enabled and c.starts_at is not null
      and c.awarded_count<c.max_awards
      and c.awarded_cents+c.award_cents<=c.budget_cents,
  'awardCents',c.award_cents,
  'remaining',greatest(0,least(c.max_awards-c.awarded_count,
       (c.budget_cents-c.awarded_cents)/c.award_cents)),
  'claimed',c.awarded_count)
 from public.platform_welcome_campaign_v1_815 c
 where c.campaign_key='welcome_2026_815';
$$;
revoke all on function public.welcome_bonus_status_v1_815() from public;
grant execute on function public.welcome_bonus_status_v1_815() to anon, authenticated;
