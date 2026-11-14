-- Automatic recovery of existing platform payments. No charge creation and
-- no second credit engine: only the existing verified settlement handlers run.
create table public.platform_payment_reconciliation_config (
 id boolean primary key default true check(id),
 enabled boolean not null default false,
 token_sha256 text not null check(token_sha256 ~ '^[0-9a-f]{64}$'),
 activated_at timestamptz,
 last_enqueued_at timestamptz,
 last_request_id bigint,
 last_completed_at timestamptz
);
alter table public.platform_payment_reconciliation_config enable row level security;
revoke all on public.platform_payment_reconciliation_config from public,anon,authenticated;
grant select on public.platform_payment_reconciliation_config to service_role;

create table public.platform_payment_reconciliation_queue (
 kind text not null check(kind in ('billing','coupon','mobility','advertising','merchant_sale')),
 resource_id uuid not null,
 priority smallint not null default 0 check(priority between 0 and 2),
 next_check_at timestamptz not null default clock_timestamp(),
 lease_token uuid,
 lease_until timestamptz,
 attempts integer not null default 0 check(attempts>=0),
 last_outcome text not null default 'pending' check(last_outcome in ('pending','verified','closed','retry','review')),
 last_reason text,
 business_status text,
 last_checked_at timestamptz,
 created_at timestamptz not null default clock_timestamp(),
 primary key(kind,resource_id),
 check((lease_token is null)=(lease_until is null)),
 check(last_reason is null or last_reason ~ '^[A-Za-z0-9_]{1,100}$')
);
create index platform_payment_reconciliation_due_idx
 on public.platform_payment_reconciliation_queue(priority,next_check_at);
alter table public.platform_payment_reconciliation_queue enable row level security;
revoke all on public.platform_payment_reconciliation_queue from public,anon,authenticated;
grant select on public.platform_payment_reconciliation_queue to service_role;

do $setup$
declare v_token text;
begin
 if exists(select 1 from vault.secrets where name='tamao_payment_reconciliation_token_v1') then
  raise exception 'PAYMENT_RECONCILIATION_VAULT_CONFLICT';
 end if;
 v_token:=encode(extensions.gen_random_bytes(32),'hex');
 perform vault.create_secret(v_token,'tamao_payment_reconciliation_token_v1',
  'Machine-only reconciliation of existing TAMÃO payments; never creates charges');
 insert into public.platform_payment_reconciliation_config(id,token_sha256)
 values(true,encode(extensions.digest(v_token,'sha256'),'hex'));
 v_token:=null;
end $setup$;

create function public.platform_payment_reconciliation_enqueue()
returns trigger language plpgsql security definer set search_path=pg_catalog
as $fn$
declare v_kind text; v_row jsonb; v_resource uuid;
begin
 v_kind:=case tg_table_name
  when 'merchant_billing_provider_charges' then 'billing'
  when 'clube_coupon_paid_invoices' then 'coupon'
  when 'mobility_fee_pix_invoices_v1_837' then 'mobility'
  when 'ads_independent_checkouts_v1_886' then 'advertising'
  when 'merchant_sale_payment_attempts' then 'merchant_sale'
  else null end;
 if tg_table_schema<>'public' or v_kind is null then raise exception 'PAYMENT_QUEUE_SOURCE_INVALID'; end if;
 v_row:=to_jsonb(new);
 v_resource:=(v_row->>case when v_kind='advertising' then 'campaign_id' else 'id' end)::uuid;
 insert into public.platform_payment_reconciliation_queue(kind,resource_id,next_check_at)
 values(v_kind,v_resource,clock_timestamp()+interval '30 seconds')
 on conflict(kind,resource_id) do update
 set next_check_at=least(platform_payment_reconciliation_queue.next_check_at,excluded.next_check_at),priority=0;
 return new;
end $fn$;
revoke all on function public.platform_payment_reconciliation_enqueue() from public,anon,authenticated,service_role;

create trigger payment_reconciliation_billing after insert or update of status,provider_charge_id
 on public.merchant_billing_provider_charges for each row execute function public.platform_payment_reconciliation_enqueue();
create trigger payment_reconciliation_coupon after insert or update of status,provider_order_id
 on public.clube_coupon_paid_invoices for each row execute function public.platform_payment_reconciliation_enqueue();
create trigger payment_reconciliation_mobility after insert or update of status,provider_order_id
 on public.mobility_fee_pix_invoices_v1_837 for each row execute function public.platform_payment_reconciliation_enqueue();
create trigger payment_reconciliation_advertising after insert or update of status,preference_id
 on public.ads_independent_checkouts_v1_886 for each row execute function public.platform_payment_reconciliation_enqueue();
create trigger payment_reconciliation_merchant_sale after insert or update of status,provider_order_id
 on public.merchant_sale_payment_attempts for each row execute function public.platform_payment_reconciliation_enqueue();

insert into public.platform_payment_reconciliation_queue(kind,resource_id)
 select 'billing',id from public.merchant_billing_provider_charges where created_at>=now()-interval '30 days'
 union all select 'coupon',id from public.clube_coupon_paid_invoices where created_at>=now()-interval '30 days'
 union all select 'mobility',id from public.mobility_fee_pix_invoices_v1_837 where created_at>=now()-interval '30 days'
 union all select 'advertising',campaign_id from public.ads_independent_checkouts_v1_886 where reserved_at>=now()-interval '30 days'
 union all select 'merchant_sale',id from public.merchant_sale_payment_attempts where created_at>=now()-interval '30 days'
 on conflict do nothing;

create function public.platform_payment_reconciliation_authorize(p_token_sha text)
returns boolean language sql stable security definer set search_path=pg_catalog
as $fn$
 select exists(select 1 from public.platform_payment_reconciliation_config
  where id and enabled and p_token_sha ~ '^[0-9a-f]{64}$' and token_sha256=p_token_sha)
$fn$;
revoke all on function public.platform_payment_reconciliation_authorize(text) from public,anon,authenticated;
grant execute on function public.platform_payment_reconciliation_authorize(text) to service_role;

create function public.platform_payment_reconciliation_claim(p_limit integer default 8)
returns table(kind text,resource_id uuid,lease_token uuid)
language plpgsql security definer set search_path=pg_catalog
as $fn$
begin
 if p_limit not between 1 and 8 or p_limit is null then raise exception 'PAYMENT_QUEUE_LIMIT_INVALID'; end if;
 if not exists(select 1 from public.platform_payment_reconciliation_config where id and enabled) then
  return;
 end if;
 return query with picked as (
  select q.kind,q.resource_id from public.platform_payment_reconciliation_queue q
  where q.next_check_at<=clock_timestamp() and (q.lease_until is null or q.lease_until<=clock_timestamp())
  order by q.priority,q.next_check_at,q.kind,q.resource_id limit p_limit for update skip locked
 ) update public.platform_payment_reconciliation_queue q
 set lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '3 minutes',attempts=q.attempts+1
 from picked p where q.kind=p.kind and q.resource_id=p.resource_id
 returning q.kind,q.resource_id,q.lease_token;
end $fn$;
revoke all on function public.platform_payment_reconciliation_claim(integer) from public,anon,authenticated;
grant execute on function public.platform_payment_reconciliation_claim(integer) to service_role;

create function public.platform_payment_reconciliation_finish(
 p_kind text,p_resource uuid,p_lease uuid,p_outcome text,p_reason text,p_business_status text
) returns boolean language plpgsql security definer set search_path=pg_catalog
as $fn$
declare v_attempts integer; v_delay interval;
begin
 if p_outcome not in ('pending','verified','closed','retry','review') or p_outcome is null
  or p_reason is null or p_reason !~ '^[A-Za-z0-9_]{1,100}$'
  or length(coalesce(p_business_status,''))>64 then raise exception 'PAYMENT_QUEUE_RESULT_INVALID'; end if;
 select attempts into v_attempts from public.platform_payment_reconciliation_queue
 where kind=p_kind and resource_id=p_resource and lease_token=p_lease
  and lease_until>clock_timestamp() for update;
 if not found then return false; end if;
 v_delay:=case p_outcome
  when 'pending' then case when v_attempts<6 then interval '2 minutes' else interval '15 minutes' end
  when 'verified' then interval '6 hours'
  when 'closed' then interval '24 hours'
  when 'review' then interval '1 hour'
  else make_interval(secs=>least(3600,60*power(2,least(v_attempts,6))::integer)) end;
 update public.platform_payment_reconciliation_queue
 set last_outcome=p_outcome,last_reason=p_reason,business_status=p_business_status,
  last_checked_at=clock_timestamp(),next_check_at=clock_timestamp()+v_delay,
  priority=case when p_outcome in ('verified','closed') then 2 else 1 end,
  lease_token=null,lease_until=null
 where kind=p_kind and resource_id=p_resource and lease_token=p_lease;
 update public.platform_payment_reconciliation_config set last_completed_at=clock_timestamp() where id;
 return true;
end $fn$;
revoke all on function public.platform_payment_reconciliation_finish(text,uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.platform_payment_reconciliation_finish(text,uuid,uuid,text,text,text) to service_role;

create function public.platform_payment_reconciliation_tick()
returns boolean language plpgsql security definer set search_path=pg_catalog
as $fn$
declare v_token text; v_request bigint; v_config record;
begin
 select * into v_config from public.platform_payment_reconciliation_config where id for update;
 if not found or not v_config.enabled or v_config.last_enqueued_at>=clock_timestamp()-interval '90 seconds' then return false; end if;
 select decrypted_secret into v_token from vault.decrypted_secrets where name='tamao_payment_reconciliation_token_v1';
 if v_token is null or v_token !~ '^[0-9a-f]{64}$' then raise exception 'PAYMENT_QUEUE_SECRET_UNAVAILABLE'; end if;
 v_request:=net.http_post(url:='https://lgugwujpunhslavewffd.supabase.co/functions/v1/payment-reconcile',
  headers:=jsonb_build_object('Content-Type','application/json','X-Tamao-Payment-Cron-Token',v_token),
  body:='{"source":"supabase_payment_reconciliation"}'::jsonb,timeout_milliseconds:=110000);
 update public.platform_payment_reconciliation_config set last_enqueued_at=clock_timestamp(),last_request_id=v_request where id;
 v_token:=null;
 return true;
end $fn$;
revoke all on function public.platform_payment_reconciliation_tick() from public,anon,authenticated,service_role;
select cron.schedule('tamao-payment-reconciliation','*/2 * * * *','select public.platform_payment_reconciliation_tick()');
update cron.job set active=false where jobname='tamao-payment-reconciliation';
