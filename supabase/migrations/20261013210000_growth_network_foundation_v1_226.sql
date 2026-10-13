-- TAMÃO V1.226 — customer/merchant network attribution before commerce.
-- Only authenticated service code can create and observe links. No earnings,
-- cashback, fee adjustment, wallets, payouts, or multi-level commissions.
create table if not exists public.growth_merchant_invites_v1_226(
  merchant_id uuid primary key references public.merchants(id) on delete cascade,
  invite_code text not null unique
    check(invite_code ~ '^TMR[A-F0-9]{24}$'),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default clock_timestamp()
);
create index if not exists growth_merchant_invites_creator_v1_226
 on public.growth_merchant_invites_v1_226(created_by);

create table if not exists public.growth_lead_attributions_v1_226(
  lead_id uuid primary key references public.prelaunch_leads(id) on delete cascade,
  referral_code text not null check(length(referral_code) between 5 and 40),
  inviter_kind text not null check(inviter_kind in ('customer','merchant')),
  inviter_user_id uuid references auth.users(id),
  inviter_merchant_id uuid references public.merchants(id),
  attributed_at timestamptz not null default clock_timestamp(),
  reward_eligible boolean not null default false check(reward_eligible=false),
  check((inviter_kind='customer' and inviter_user_id is not null and inviter_merchant_id is null)
    or (inviter_kind='merchant' and inviter_merchant_id is not null and inviter_user_id is null))
);
create index if not exists growth_lead_attributions_inviter_user_v1_226
 on public.growth_lead_attributions_v1_226(inviter_user_id) where inviter_user_id is not null;
create index if not exists growth_lead_attributions_inviter_merchant_v1_226
 on public.growth_lead_attributions_v1_226(inviter_merchant_id) where inviter_merchant_id is not null;
create index if not exists growth_lead_attributions_created_v1_226
 on public.growth_lead_attributions_v1_226(attributed_at desc);
alter table public.growth_merchant_invites_v1_226 enable row level security;
alter table public.growth_lead_attributions_v1_226 enable row level security;
revoke all on public.growth_merchant_invites_v1_226,public.growth_lead_attributions_v1_226
 from public,anon,authenticated;
grant select,insert on public.growth_merchant_invites_v1_226 to service_role;
grant select,insert on public.growth_lead_attributions_v1_226 to service_role;

-- Called only after the consented lead has been accepted by the existing
-- idempotent capture RPC. Its first valid attribution is immutable.
-- A resubmission or replay of an older lead cannot claim it retroactively.
create or replace function public.record_growth_lead_attribution_v1_226(
 p_lead_id uuid,p_referral_code text
) returns jsonb language plpgsql volatile security invoker
set search_path=pg_catalog
as $fn$
declare
 v_lead public.prelaunch_leads%rowtype;
 v_code text:=upper(btrim(coalesce(p_referral_code,'')));
 v_merchant uuid;
 v_user uuid;
 v_inserted uuid;
begin
 if v_code !~ '^[A-Z0-9]{5,40}$' then
   return jsonb_build_object('recorded',false,'reason','INVALID_CODE');
 end if;
 select * into v_lead from public.prelaunch_leads where id=p_lead_id;
 if v_lead.id is null or v_lead.consent_at is null
    or v_lead.created_at<clock_timestamp()-interval '10 minutes'
    or v_lead.created_at>clock_timestamp()+interval '1 minute' then
   return jsonb_build_object('recorded',false,'reason','LEAD_NOT_ELIGIBLE');
 end if;
 if v_code ~ '^TMR[A-F0-9]{24}$' then
   select i.merchant_id into v_merchant from public.growth_merchant_invites_v1_226 i
     where i.invite_code=v_code;
   if v_merchant is null then
     return jsonb_build_object('recorded',false,'reason','CODE_NOT_FOUND');
   end if;
   insert into public.growth_lead_attributions_v1_226
     (lead_id,referral_code,inviter_kind,inviter_merchant_id)
   values(v_lead.id,v_code,'merchant',v_merchant)
   on conflict (lead_id) do nothing returning lead_id into v_inserted;
 else
   select p.user_id into v_user from public.profiles p
     where upper(p.referral_code)=v_code;
   if v_user is null then
     return jsonb_build_object('recorded',false,'reason','CODE_NOT_FOUND');
   end if;
   insert into public.growth_lead_attributions_v1_226
     (lead_id,referral_code,inviter_kind,inviter_user_id)
   values(v_lead.id,v_code,'customer',v_user)
   on conflict (lead_id) do nothing returning lead_id into v_inserted;
 end if;
 return jsonb_build_object('recorded',v_inserted is not null,
   'reason',case when v_inserted is null then 'ALREADY_ATTRIBUTED' else 'CAPTURED_UNREWARDED' end);
end;
$fn$;
revoke all on function public.record_growth_lead_attribution_v1_226(uuid,text)
 from public,anon,authenticated;
grant execute on function public.record_growth_lead_attribution_v1_226(uuid,text)
 to service_role;

-- Merchant owners/managers get a stable random invite code and aggregate
-- counts of consented leads, never private lead records or customer phones.
-- This operation cannot grant money or mark a partner commercially enabled.
create or replace function public.merchant_growth_network_v1_226(
 p_actor_user_id uuid,p_merchant_id uuid
) returns jsonb language plpgsql volatile security invoker
set search_path=pg_catalog
as $fn$
declare v_code text;v_customer_count bigint;v_merchant_count bigint;
begin
 if not exists(select 1 from public.merchant_members m
   where m.user_id=p_actor_user_id and m.merchant_id=p_merchant_id
     and m.active and m.member_role in ('owner','manager')) then
   raise exception 'MERCHANT_GROWTH_ACCESS_DENIED' using errcode='42501';
 end if;
 insert into public.growth_merchant_invites_v1_226(merchant_id,invite_code,created_by)
 values(p_merchant_id,'TMR'||upper(encode(extensions.gen_random_bytes(12),'hex')),p_actor_user_id)
 on conflict (merchant_id) do nothing;
 select i.invite_code into v_code from public.growth_merchant_invites_v1_226 i
  where i.merchant_id=p_merchant_id;
 if v_code is null then raise exception 'GROWTH_INVITE_CODE_UNAVAILABLE'; end if;
 select count(*) filter(where l.lead_type='customer'),
        count(*) filter(where l.lead_type='merchant')
 into v_customer_count,v_merchant_count
 from public.growth_lead_attributions_v1_226 a
 join public.prelaunch_leads l on l.id=a.lead_id
 where a.inviter_kind='merchant' and a.inviter_merchant_id=p_merchant_id;
 return jsonb_build_object('source','merchant_network_v1_226',
   'merchantId',p_merchant_id,'inviteCode',v_code,
   'customerInterests',v_customer_count,'merchantInterests',v_merchant_count,
   'rewardEnabled',false,'availableCreditCents',0,'readOnlyRewards',true);
end;
$fn$;
revoke all on function public.merchant_growth_network_v1_226(uuid,uuid)
 from public,anon,authenticated;
grant execute on function public.merchant_growth_network_v1_226(uuid,uuid)
 to service_role;
