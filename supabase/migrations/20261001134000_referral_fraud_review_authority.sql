-- Chama São Gabriel — referral fraud review authority v1.9.1
-- Referral cash rewards are separate from customer cashback. Suspicious referral
-- patterns are held for admin review while the underlying settled order remains valid.

create table if not exists public.referral_reward_reviews (
  order_id uuid primary key references public.orders(id) on delete cascade,
  referrer_user_id uuid not null references auth.users(id) on delete restrict,
  referred_user_id uuid not null references auth.users(id) on delete restrict,
  risk_status text not null
    check (risk_status in ('clear','review_required','approved','rejected')),
  risk_reasons jsonb not null default '[]'::jsonb
    check (jsonb_typeof(risk_reasons)='array'),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete restrict,
  review_notes text check (review_notes is null or char_length(review_notes)<=1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (risk_status in ('approved','rejected') and reviewed_at is not null and reviewed_by is not null)
    or
    (risk_status in ('clear','review_required') and reviewed_at is null and reviewed_by is null)
  )
);

alter table public.referral_reward_reviews enable row level security;
revoke all on table public.referral_reward_reviews from anon, authenticated;
grant all on table public.referral_reward_reviews to service_role;

create index if not exists referral_reward_reviews_referrer_idx
  on public.referral_reward_reviews(referrer_user_id,created_at desc);

create index if not exists referral_reward_reviews_referred_idx
  on public.referral_reward_reviews(referred_user_id);

create index if not exists referral_reward_reviews_reviewed_by_idx
  on public.referral_reward_reviews(reviewed_by)
  where reviewed_by is not null;

create index if not exists referral_reward_reviews_pending_idx
  on public.referral_reward_reviews(created_at)
  where risk_status='review_required';

create or replace function public.normalized_address_for_risk(
  p_address text
)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select regexp_replace(lower(trim(coalesce(p_address,''))), E'\\s+', ' ', 'g');
$$;

revoke all on function public.normalized_address_for_risk(text)
from public, anon, authenticated;
grant execute on function public.normalized_address_for_risk(text)
to postgres, service_role;

create or replace function public.assess_referral_reward_risk()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_order public.orders%rowtype;
  v_reasons jsonb:='[]'::jsonb;
  v_normalized_address text;
  v_same_address boolean:=false;
  v_velocity_count integer:=0;
  v_address_referral_count integer:=0;
  v_status text:='clear';
begin
  if new.referral_pending_cents<=0
     or new.referrer_user_id is null then
    return new;
  end if;

  select *
  into v_order
  from public.orders
  where id=new.order_id;

  if not found then
    raise exception 'ORDER_NOT_FOUND' using errcode='P0002';
  end if;

  v_normalized_address:=public.normalized_address_for_risk(v_order.address_text);

  select exists(
    select 1
    from public.orders o
    where o.customer_id=new.referrer_user_id
      and o.id<>new.order_id
      and o.status='SETTLED'
      and o.financial_state='settled'
      and public.normalized_address_for_risk(o.address_text)=v_normalized_address
  )
  into v_same_address;

  if v_same_address then
    v_reasons:=v_reasons||jsonb_build_array('same_delivery_address_as_referrer');
  end if;

  select count(*)
  into v_velocity_count
  from public.order_reward_grants g
  where g.referrer_user_id=new.referrer_user_id
    and g.referral_pending_cents>0
    and g.created_at>=clock_timestamp()-interval '24 hours';

  if v_velocity_count>=5 then
    v_reasons:=v_reasons||jsonb_build_array('high_referral_velocity_24h');
  end if;

  select count(distinct g.customer_id)
  into v_address_referral_count
  from public.order_reward_grants g
  join public.orders o on o.id=g.order_id
  where g.referrer_user_id=new.referrer_user_id
    and g.referral_pending_cents>0
    and g.created_at>=clock_timestamp()-interval '30 days'
    and public.normalized_address_for_risk(o.address_text)=v_normalized_address;

  if v_address_referral_count>=3 then
    v_reasons:=v_reasons||jsonb_build_array('multiple_referred_accounts_same_address');
  end if;

  if jsonb_array_length(v_reasons)>0 then
    v_status:='review_required';
  end if;

  insert into public.referral_reward_reviews(
    order_id,referrer_user_id,referred_user_id,risk_status,risk_reasons
  )
  values(
    new.order_id,new.referrer_user_id,new.customer_id,v_status,v_reasons
  )
  on conflict(order_id) do nothing;

  if v_status='review_required' then
    insert into public.order_events(
      order_id,actor_user_id,actor_type,event_type,title,detail,metadata
    )
    values(
      new.order_id,null,'system','REFERRAL_REVIEW_REQUIRED',
      'Indicação em análise',
      'A comissão de indicação ficou retida para revisão de segurança.',
      jsonb_build_object('riskReasons',v_reasons)
    );
  end if;

  return new;
end;
$$;

revoke all on function public.assess_referral_reward_risk()
from public, anon, authenticated;
grant execute on function public.assess_referral_reward_risk()
to postgres, service_role;

drop trigger if exists assess_referral_reward_risk_after_grant
on public.order_reward_grants;

create trigger assess_referral_reward_risk_after_grant
after insert on public.order_reward_grants
for each row
when (new.referral_pending_cents>0 and new.referrer_user_id is not null)
execute function public.assess_referral_reward_risk();

create or replace function public.process_reward_maturation()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_order_id uuid;
  v_order public.orders%rowtype;
  v_grant public.order_reward_grants%rowtype;
  v_review public.referral_reward_reviews%rowtype;
  v_referrer_is_anonymous boolean;
  v_referred_is_anonymous boolean;
  v_count integer:=0;
  v_key text;
begin
  for v_order_id in
    select g.order_id
    from public.order_reward_grants g
    where g.referral_pending_cents>0
      and g.matured_at is null
      and g.reversed_at is null
      and g.commission_available_at<=clock_timestamp()
    order by g.commission_available_at
    limit 100
  loop
    perform pg_advisory_xact_lock(
      hashtextextended('reward:'||v_order_id::text,0)
    );

    select *
    into v_order
    from public.orders
    where id=v_order_id
    for update;

    if not found
       or v_order.status<>'SETTLED'
       or v_order.financial_state<>'settled' then
      continue;
    end if;

    select *
    into v_grant
    from public.order_reward_grants
    where order_id=v_order_id
    for update;

    if not found
       or v_grant.referral_pending_cents<=0
       or v_grant.matured_at is not null
       or v_grant.reversed_at is not null
       or v_grant.commission_available_at>clock_timestamp()
       or v_grant.referrer_user_id is null then
      continue;
    end if;

    select *
    into v_review
    from public.referral_reward_reviews
    where order_id=v_grant.order_id
    for update;

    if not found
       or v_review.risk_status not in ('clear','approved') then
      continue;
    end if;

    select u.is_anonymous
    into v_referrer_is_anonymous
    from auth.users u
    where u.id=v_grant.referrer_user_id;

    if not found or v_referrer_is_anonymous is true then
      continue;
    end if;

    select u.is_anonymous
    into v_referred_is_anonymous
    from auth.users u
    where u.id=v_grant.customer_id;

    if not found or v_referred_is_anonymous is true then
      continue;
    end if;

    v_key:='reward:'||replace(v_grant.order_id::text,'-','');

    insert into public.wallet_entries(
      user_id,order_id,bucket,entry_type,amount_cents,idempotency_key,metadata
    )
    values
      (
        v_grant.referrer_user_id,v_grant.order_id,'commission_pending',
        'referral_pending_release',-v_grant.referral_pending_cents,
        v_key||':referral-pending-release',
        jsonb_build_object('maturedAt',clock_timestamp())
      ),
      (
        v_grant.referrer_user_id,v_grant.order_id,'commission_available',
        'referral_available',v_grant.referral_pending_cents,
        v_key||':referral-available',
        jsonb_build_object('maturedAt',clock_timestamp())
      )
    on conflict(idempotency_key) do nothing;

    update public.order_reward_grants
    set matured_at=clock_timestamp()
    where order_id=v_grant.order_id
      and matured_at is null
      and reversed_at is null;

    insert into public.order_events(
      order_id,actor_user_id,actor_type,event_type,title,detail,metadata
    )
    values(
      v_grant.order_id,null,'system','COMMISSION_AVAILABLE',
      'Comissão liberada',
      'A janela de validação terminou, as identidades foram verificadas e a comissão ficou disponível.',
      jsonb_build_object('amountCents',v_grant.referral_pending_cents)
    );

    v_count:=v_count+1;
  end loop;

  return jsonb_build_object('maturedCommissions',v_count);
end;
$$;

revoke all on function public.process_reward_maturation()
from public, anon, authenticated;
grant execute on function public.process_reward_maturation()
to postgres, service_role;

create or replace function public.admin_review_referral_reward(
  p_actor_user_id uuid,
  p_order_id uuid,
  p_decision text,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_review public.referral_reward_reviews%rowtype;
  v_grant public.order_reward_grants%rowtype;
  v_amount integer:=0;
  v_key text;
  v_bucket text;
  v_entry_type text;
begin
  perform public.require_platform_admin(p_actor_user_id);

  if p_decision not in ('approved','rejected') then
    raise exception 'INVALID_REFERRAL_REVIEW_DECISION' using errcode='22023';
  end if;

  if p_notes is not null and char_length(trim(p_notes))>1000 then
    raise exception 'NOTES_TOO_LONG' using errcode='22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('reward:'||p_order_id::text,0)
  );

  select *
  into v_review
  from public.referral_reward_reviews
  where order_id=p_order_id
  for update;

  if not found then
    raise exception 'REFERRAL_REVIEW_NOT_FOUND' using errcode='P0002';
  end if;

  if v_review.risk_status=p_decision then
    return jsonb_build_object(
      'ok',true,'orderId',p_order_id,'riskStatus',p_decision,'alreadyInState',true
    );
  end if;

  if v_review.risk_status in ('approved','rejected') then
    raise exception 'REFERRAL_REVIEW_ALREADY_FINAL' using errcode='40001';
  end if;

  select *
  into v_grant
  from public.order_reward_grants
  where order_id=p_order_id
  for update;

  if not found then
    raise exception 'REWARD_GRANT_NOT_FOUND' using errcode='P0002';
  end if;

  if p_decision='rejected' then
    v_amount:=v_grant.referral_pending_cents;

    if v_amount>0 then
      v_key:='referral-risk:'||replace(p_order_id::text,'-','')||':reject';

      if v_grant.matured_at is null then
        v_bucket:='commission_pending';
        v_entry_type:='referral_pending_rejected';
      else
        v_bucket:='commission_available';
        v_entry_type:='referral_available_rejected';
      end if;

      insert into public.wallet_entries(
        user_id,order_id,bucket,entry_type,amount_cents,idempotency_key,metadata
      )
      values(
        v_grant.referrer_user_id,p_order_id,v_bucket,v_entry_type,-v_amount,
        v_key,
        jsonb_build_object(
          'riskReasons',v_review.risk_reasons,
          'reviewedBy',p_actor_user_id,
          'reviewedAt',clock_timestamp()
        )
      )
      on conflict(idempotency_key) do nothing;

      update public.order_reward_grants
      set referral_pending_cents=0,
          commission_available_at=null,
          platform_contribution_cents=platform_contribution_cents+v_amount
      where order_id=p_order_id;
    end if;
  end if;

  update public.referral_reward_reviews
  set risk_status=p_decision,
      reviewed_at=clock_timestamp(),
      reviewed_by=p_actor_user_id,
      review_notes=nullif(trim(p_notes),''),
      updated_at=clock_timestamp()
  where order_id=p_order_id;

  insert into public.platform_admin_audit(
    actor_user_id,action,target_type,target_id,metadata
  )
  values(
    p_actor_user_id,
    case when p_decision='approved'
      then 'referral_reward_approved'
      else 'referral_reward_rejected'
    end,
    'order',
    p_order_id::text,
    jsonb_build_object(
      'riskReasons',v_review.risk_reasons,
      'amountCents',v_amount,
      'notes',p_notes
    )
  );

  insert into public.order_events(
    order_id,actor_user_id,actor_type,event_type,title,detail,metadata
  )
  values(
    p_order_id,p_actor_user_id,'admin',
    case when p_decision='approved'
      then 'REFERRAL_REVIEW_APPROVED'
      else 'REFERRAL_REVIEW_REJECTED'
    end,
    case when p_decision='approved'
      then 'Indicação aprovada'
      else 'Comissão de indicação rejeitada'
    end,
    case when p_decision='approved'
      then 'A revisão de segurança aprovou a comissão; as demais condições ainda precisam ser cumpridas.'
      else 'A revisão de segurança rejeitou a comissão; o pedido e cashback do cliente permanecem válidos.'
    end,
    jsonb_build_object('riskReasons',v_review.risk_reasons)
  );

  return jsonb_build_object(
    'ok',true,'orderId',p_order_id,'riskStatus',p_decision,'amountCents',v_amount
  );
end;
$$;

revoke all on function public.admin_review_referral_reward(uuid,uuid,text,text)
from public, anon, authenticated;
grant execute on function public.admin_review_referral_reward(uuid,uuid,text,text)
to service_role;

create or replace function public.admin_referral_review_action(
  p_actor_user_id uuid,
  p_order_id uuid,
  p_decision text,
  p_notes text,
  p_idempotency_key text,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_action public.action_requests%rowtype;
  v_result jsonb;
begin
  perform public.require_platform_admin(p_actor_user_id);

  if p_idempotency_key is null
     or char_length(p_idempotency_key)<12
     or char_length(p_idempotency_key)>120 then
    raise exception 'INVALID_IDEMPOTENCY_KEY' using errcode='22023';
  end if;

  if p_request_hash is null
     or char_length(p_request_hash)<>64
     or p_request_hash!~'^[0-9a-f]{64}$' then
    raise exception 'INVALID_REQUEST_HASH' using errcode='22023';
  end if;

  insert into public.action_requests(
    idempotency_key,user_id,action_name,request_hash
  )
  values(
    p_idempotency_key,p_actor_user_id,
    'admin-ops:review-referral',p_request_hash
  )
  on conflict(idempotency_key) do nothing;

  select *
  into v_action
  from public.action_requests
  where idempotency_key=p_idempotency_key
  for update;

  if not found then
    raise exception 'IDEMPOTENCY_STATE_INVALID' using errcode='40001';
  end if;

  if v_action.user_id<>p_actor_user_id
     or v_action.action_name<>'admin-ops:review-referral'
     or v_action.request_hash<>p_request_hash then
    raise exception 'IDEMPOTENCY_CONFLICT' using errcode='23505';
  end if;

  if v_action.completed_at is not null then
    return v_action.result_json;
  end if;

  v_result:=public.admin_review_referral_reward(
    p_actor_user_id,p_order_id,p_decision,p_notes
  );

  update public.action_requests
  set result_json=v_result,
      completed_at=clock_timestamp()
  where idempotency_key=p_idempotency_key;

  return v_result;
end;
$$;

revoke all on function public.admin_referral_review_action(
  uuid,uuid,text,text,text,text
) from public, anon, authenticated;
grant execute on function public.admin_referral_review_action(
  uuid,uuid,text,text,text,text
) to service_role;
