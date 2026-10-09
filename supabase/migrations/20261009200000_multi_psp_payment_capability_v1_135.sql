-- TAMÃO V1.135 — Payment Capability Layer multi-PSP
-- Seller-sale funds always belong to the merchant. TAMÃO only orchestrates
-- payment routes and records verification evidence; no split/custody is introduced.

create table if not exists public.payment_provider_catalog (
  provider_key text primary key,
  display_name text not null,
  connection_mode text not null,
  verification_level text not null,
  adapter_status text not null,
  supported_methods jsonb not null default '[]'::jsonb,
  supports_webhook boolean not null default false,
  supports_lookup boolean not null default false,
  requires_platform_credentials boolean not null default true,
  customer_visible boolean not null default false,
  funds_flow text not null default 'merchant_direct',
  sort_order integer not null default 100,
  notes text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint payment_provider_catalog_key_check
    check (provider_key ~ '^[a-z][a-z0-9_]{1,39}$'),
  constraint payment_provider_catalog_connection_mode_check
    check (connection_mode in ('oauth','api_credentials','terminal','manual')),
  constraint payment_provider_catalog_verification_level_check
    check (verification_level in ('provider','device','merchant')),
  constraint payment_provider_catalog_adapter_status_check
    check (adapter_status in ('implemented','ready_for_credentials','manual_only','planned')),
  constraint payment_provider_catalog_methods_check
    check (jsonb_typeof(supported_methods)='array'),
  constraint payment_provider_catalog_funds_flow_check
    check (funds_flow='merchant_direct'),
  constraint payment_provider_catalog_sort_check
    check (sort_order between 1 and 10000)
);

alter table public.payment_provider_catalog enable row level security;
revoke all on table public.payment_provider_catalog from public,anon,authenticated;
grant select,insert,update,delete on table public.payment_provider_catalog to service_role;

insert into public.payment_provider_catalog(
  provider_key,display_name,connection_mode,verification_level,adapter_status,
  supported_methods,supports_webhook,supports_lookup,
  requires_platform_credentials,customer_visible,funds_flow,sort_order,notes
)
values
  ('manual','Sem integração automática','manual','merchant','implemented',
    '["pix","card","card_credit","card_debit","cash","bank_transfer","payment_link"]'::jsonb,
    false,false,false,false,'merchant_direct',10,
    'Fallback operacional: a revenda confirma o recebimento; TAMÃO não recebe a venda.'),
  ('mercadopago','Mercado Pago','oauth','provider','implemented',
    '["pix","card","card_credit","card_debit","payment_link"]'::jsonb,
    true,true,true,false,'merchant_direct',20,
    'OAuth de conta da própria revenda; recebimento direto e validação por API/webhook.'),
  ('pagbank','PagBank','oauth','provider','ready_for_credentials',
    '["pix","card","card_credit","card_debit","payment_link"]'::jsonb,
    true,true,true,false,'merchant_direct',30,
    'Connect Authorization; ativação depende do client/token de parceiro do TAMÃO.'),
  ('stone','Stone','api_credentials','provider','ready_for_credentials',
    '["pix","card","card_credit","card_debit"]'::jsonb,
    true,true,true,false,'merchant_direct',40,
    'Conciliação/PIX e credenciamento Stone; ativação depende das credenciais/contrato da revenda.'),
  ('getnet','Getnet','terminal','device','ready_for_credentials',
    '["pix","card","card_credit","card_debit"]'::jsonb,
    true,true,true,false,'merchant_direct',50,
    'Terminal/Get Smart e correlação por transação; ativação depende do credenciamento Getnet.'),
  ('pagarme','Pagar.me','api_credentials','provider','ready_for_credentials',
    '["pix","card","card_credit","card_debit"]'::jsonb,
    true,true,true,false,'merchant_direct',60,
    'Conector preparado na capability layer; credenciais ainda não homologadas no TAMÃO.'),
  ('asaas','Asaas','api_credentials','provider','ready_for_credentials',
    '["pix","card","card_credit","bank_transfer","payment_link"]'::jsonb,
    true,true,true,false,'merchant_direct',70,
    'Conector preparado na capability layer; credenciais ainda não homologadas no TAMÃO.'),
  ('cielo','Cielo','api_credentials','provider','ready_for_credentials',
    '["card","card_credit","card_debit"]'::jsonb,
    true,true,true,false,'merchant_direct',80,
    'Conector preparado na capability layer; credenciais ainda não homologadas no TAMÃO.'),
  ('rede','Rede','api_credentials','provider','ready_for_credentials',
    '["card","card_credit","card_debit"]'::jsonb,
    true,true,true,false,'merchant_direct',90,
    'Conector preparado na capability layer; credenciais ainda não homologadas no TAMÃO.'),
  ('woovi','Woovi/OpenPix','api_credentials','provider','ready_for_credentials',
    '["pix","payment_link"]'::jsonb,
    true,true,true,false,'merchant_direct',100,
    'Compatibilidade de provider existente; recebimento direto só será homologado separadamente.'),
  ('nubank','Nu Empresas','manual','merchant','manual_only',
    '["pix","payment_link"]'::jsonb,
    false,false,false,false,'merchant_direct',110,
    'Aceito como método da revenda; verificação automática permanece indisponível sem API/partner program adequado.')
on conflict(provider_key) do update set
  display_name=excluded.display_name,
  connection_mode=excluded.connection_mode,
  verification_level=excluded.verification_level,
  adapter_status=excluded.adapter_status,
  supported_methods=excluded.supported_methods,
  supports_webhook=excluded.supports_webhook,
  supports_lookup=excluded.supports_lookup,
  requires_platform_credentials=excluded.requires_platform_credentials,
  customer_visible=excluded.customer_visible,
  funds_flow=excluded.funds_flow,
  sort_order=excluded.sort_order,
  notes=excluded.notes,
  updated_at=clock_timestamp();

alter table public.merchant_payment_provider_accounts
  add column if not exists connection_mode text not null default 'oauth',
  add column if not exists verification_level text not null default 'provider',
  add column if not exists credential_kind text,
  add column if not exists credential_bundle_ciphertext text,
  add column if not exists credential_bundle_nonce text,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table public.merchant_payment_provider_accounts
  drop constraint if exists merchant_payment_provider_accounts_provider_check,
  drop constraint if exists merchant_payment_provider_accounts_active_shape;

alter table public.merchant_payment_provider_accounts
  add constraint merchant_payment_provider_accounts_provider_check
    check (provider in ('mercadopago','pagbank','stone','getnet','pagarme','asaas','cielo','rede','woovi','nubank')),
  add constraint merchant_payment_provider_accounts_connection_mode_check
    check (connection_mode in ('oauth','api_credentials','terminal','manual')),
  add constraint merchant_payment_provider_accounts_verification_level_check
    check (verification_level in ('provider','device','merchant')),
  add constraint merchant_payment_provider_accounts_credential_bundle_shape
    check (
      (
        credential_bundle_ciphertext is null
        and credential_bundle_nonce is null
      )
      or (
        credential_bundle_ciphertext is not null
        and credential_bundle_nonce is not null
        and char_length(credential_bundle_ciphertext) between 16 and 16384
        and char_length(credential_bundle_nonce) between 12 and 256
      )
    ),
  add constraint merchant_payment_provider_accounts_active_shape
    check (
      status<>'active'
      or (
        provider_account_id is not null
        and connected_at is not null
        and (
          (
            connection_mode='oauth'
            and access_token_ciphertext is not null
            and access_token_nonce is not null
          )
          or (
            connection_mode in ('api_credentials','terminal')
            and credential_bundle_ciphertext is not null
            and credential_bundle_nonce is not null
          )
          or connection_mode='manual'
        )
      )
    );

alter table public.merchant_payment_oauth_states
  add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table public.merchant_payment_oauth_states
  drop constraint if exists merchant_payment_oauth_states_provider_check;

alter table public.merchant_payment_oauth_states
  add constraint merchant_payment_oauth_states_provider_check
    check (provider in ('mercadopago','pagbank'));

create table if not exists public.merchant_payment_route_sets (
  merchant_id uuid primary key references public.merchants(id) on delete cascade,
  version integer not null default 1 check (version>=1),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default clock_timestamp()
);

create table if not exists public.merchant_payment_routes (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  payment_method text not null,
  provider text not null references public.payment_provider_catalog(provider_key) on delete restrict,
  connection_id uuid references public.merchant_payment_provider_accounts(id) on delete set null,
  channel text not null,
  verification_mode text not null,
  active boolean not null default true,
  priority integer not null default 100,
  customer_label text,
  metadata jsonb not null default '{}'::jsonb,
  confirmed_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint merchant_payment_routes_method_check
    check (payment_method in ('pix','card','card_credit','card_debit','cash','bank_transfer','payment_link')),
  constraint merchant_payment_routes_channel_check
    check (channel in ('online','delivery','external')),
  constraint merchant_payment_routes_verification_check
    check (verification_mode in ('provider_api','device','merchant_confirmed','customer_receipt')),
  constraint merchant_payment_routes_priority_check
    check (priority between 1 and 1000),
  constraint merchant_payment_routes_customer_label_check
    check (
      customer_label is null
      or (
        char_length(trim(customer_label)) between 2 and 80
        and customer_label !~ '[[:cntrl:]]'
      )
    ),
  constraint merchant_payment_routes_connection_shape
    check (
      verification_mode not in ('provider_api','device')
      or (connection_id is not null and provider<>'manual')
    ),
  unique(merchant_id,payment_method,provider,channel)
);

create index if not exists merchant_payment_routes_active_idx
  on public.merchant_payment_routes(merchant_id,payment_method,priority,id)
  where active;

create index if not exists merchant_payment_routes_connection_idx
  on public.merchant_payment_routes(connection_id)
  where connection_id is not null;

create table if not exists public.merchant_payment_route_history (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  version integer not null check (version>=1),
  routes_snapshot jsonb not null,
  changed_by uuid references auth.users(id) on delete set null,
  change_reason text not null,
  changed_at timestamptz not null default clock_timestamp(),
  unique(merchant_id,version),
  constraint merchant_payment_route_history_snapshot_check
    check (jsonb_typeof(routes_snapshot)='array'),
  constraint merchant_payment_route_history_reason_check
    check (char_length(trim(change_reason)) between 3 and 1000)
);

create index if not exists merchant_payment_route_sets_updated_by_idx
  on public.merchant_payment_route_sets(updated_by)
  where updated_by is not null;

create index if not exists merchant_payment_route_history_actor_idx
  on public.merchant_payment_route_history(changed_by)
  where changed_by is not null;

alter table public.merchant_payment_route_sets enable row level security;
alter table public.merchant_payment_routes enable row level security;
alter table public.merchant_payment_route_history enable row level security;
revoke all on table public.merchant_payment_route_sets from public,anon,authenticated;
revoke all on table public.merchant_payment_routes from public,anon,authenticated;
revoke all on table public.merchant_payment_route_history from public,anon,authenticated;
grant select,insert,update,delete on table public.merchant_payment_route_sets to service_role;
grant select,insert,update,delete on table public.merchant_payment_routes to service_role;
grant select,insert,update,delete on table public.merchant_payment_route_history to service_role;

insert into public.merchant_payment_route_sets(merchant_id,version,updated_at)
select m.id,1,clock_timestamp()
from public.merchants m
on conflict(merchant_id) do nothing;

insert into public.merchant_payment_routes(
  merchant_id,payment_method,provider,channel,verification_mode,
  active,priority,customer_label,confirmed_at
)
select
  pm.merchant_id,
  pm.payment_method,
  'manual',
  case when pm.payment_method='cash' then 'delivery'
       when pm.payment_method='card' then 'delivery'
       else 'external' end,
  'merchant_confirmed',
  pm.active,
  900,
  case pm.payment_method
    when 'pix' then 'Pix'
    when 'card' then 'Cartão'
    when 'cash' then 'Dinheiro'
    else initcap(pm.payment_method)
  end,
  pm.confirmed_at
from public.merchant_payment_methods pm
on conflict(merchant_id,payment_method,provider,channel) do nothing;

insert into public.merchant_payment_route_history(
  merchant_id,version,routes_snapshot,changed_by,change_reason,changed_at
)
select
  s.merchant_id,
  s.version,
  coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'id',r.id,
        'paymentMethod',r.payment_method,
        'provider',r.provider,
        'channel',r.channel,
        'verificationMode',r.verification_mode,
        'active',r.active,
        'priority',r.priority,
        'customerLabel',r.customer_label,
        'connectionId',r.connection_id
      )
      order by r.priority,r.payment_method,r.provider,r.id
    )
    from public.merchant_payment_routes r
    where r.merchant_id=s.merchant_id
  ),'[]'::jsonb),
  null,
  'Baseline V1.135 importada das formas de pagamento existentes.',
  s.updated_at
from public.merchant_payment_route_sets s
on conflict(merchant_id,version) do nothing;

create or replace function public.guard_merchant_payment_route_connection()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_account public.merchant_payment_provider_accounts%rowtype;
begin
  if new.verification_mode in ('provider_api','device') then
    if new.connection_id is null then
      raise exception 'PAYMENT_ROUTE_CONNECTION_REQUIRED' using errcode='23514';
    end if;
    select *
    into v_account
    from public.merchant_payment_provider_accounts
    where id=new.connection_id
    for share;
    if not found
       or v_account.merchant_id<>new.merchant_id
       or v_account.provider<>new.provider
       or v_account.status<>'active' then
      raise exception 'PAYMENT_ROUTE_CONNECTION_MISMATCH' using errcode='23514';
    end if;
  elsif new.connection_id is not null then
    select *
    into v_account
    from public.merchant_payment_provider_accounts
    where id=new.connection_id
    for share;
    if not found
       or v_account.merchant_id<>new.merchant_id
       or v_account.provider<>new.provider then
      raise exception 'PAYMENT_ROUTE_CONNECTION_MISMATCH' using errcode='23514';
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists guard_merchant_payment_route_connection_trg
  on public.merchant_payment_routes;
create trigger guard_merchant_payment_route_connection_trg
before insert or update of merchant_id,provider,connection_id,verification_mode,active
on public.merchant_payment_routes
for each row execute function public.guard_merchant_payment_route_connection();

revoke all on function public.guard_merchant_payment_route_connection()
  from public,anon,authenticated;
grant execute on function public.guard_merchant_payment_route_connection()
  to service_role;

alter table public.merchant_sale_payment_attempts
  add column if not exists payment_route_id uuid references public.merchant_payment_routes(id) on delete set null,
  add column if not exists payment_method_snapshot text,
  add column if not exists verification_level text not null default 'provider',
  add column if not exists funds_owner text not null default 'merchant';

alter table public.merchant_sale_payment_attempts
  drop constraint if exists merchant_sale_payment_attempts_provider_check,
  drop constraint if exists merchant_sale_payment_attempts_checkout_mode_check;

alter table public.merchant_sale_payment_attempts
  add constraint merchant_sale_payment_attempts_provider_check
    check (provider in ('mercadopago','pagbank','stone','getnet','pagarme','asaas','cielo','rede','woovi','nubank','manual')),
  add constraint merchant_sale_payment_attempts_checkout_mode_check
    check (checkout_mode in ('hosted','pix','terminal','delivery','external_link','manual')),
  add constraint merchant_sale_payment_attempts_payment_method_check
    check (
      payment_method_snapshot is null
      or payment_method_snapshot in ('pix','card','card_credit','card_debit','cash','bank_transfer','payment_link')
    ),
  add constraint merchant_sale_payment_attempts_verification_level_check
    check (verification_level in ('provider','device','merchant')),
  add constraint merchant_sale_payment_attempts_funds_owner_check
    check (funds_owner='merchant');

create index if not exists merchant_sale_payment_attempts_route_idx
  on public.merchant_sale_payment_attempts(payment_route_id)
  where payment_route_id is not null;

alter table public.merchant_sale_payment_events
  add column if not exists verification_level text not null default 'provider',
  add column if not exists evidence_type text not null default 'provider_webhook',
  add column if not exists funds_owner text not null default 'merchant';

alter table public.merchant_sale_payment_events
  drop constraint if exists merchant_sale_payment_events_provider_check;

alter table public.merchant_sale_payment_events
  add constraint merchant_sale_payment_events_provider_check
    check (provider in ('mercadopago','pagbank','stone','getnet','pagarme','asaas','cielo','rede','woovi','nubank','manual')),
  add constraint merchant_sale_payment_events_verification_level_check
    check (verification_level in ('provider','device','merchant')),
  add constraint merchant_sale_payment_events_evidence_type_check
    check (evidence_type in ('provider_webhook','provider_api','terminal','merchant_confirmation','customer_receipt')),
  add constraint merchant_sale_payment_events_funds_owner_check
    check (funds_owner='merchant');

create table if not exists public.merchant_sale_payment_verifications (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  payment_attempt_id uuid references public.merchant_sale_payment_attempts(id) on delete restrict,
  merchant_id uuid not null references public.merchants(id) on delete restrict,
  provider text not null references public.payment_provider_catalog(provider_key) on delete restrict,
  verification_level text not null,
  evidence_type text not null,
  provider_transaction_id text,
  amount_cents bigint not null,
  currency text not null default 'BRL',
  status text not null default 'observed',
  evidence_sha256 text not null,
  funds_owner text not null default 'merchant',
  occurred_at timestamptz,
  verified_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp(),
  constraint merchant_sale_payment_verifications_level_check
    check (verification_level in ('provider','device','merchant')),
  constraint merchant_sale_payment_verifications_evidence_type_check
    check (evidence_type in ('provider_webhook','provider_api','terminal','merchant_confirmation','customer_receipt')),
  constraint merchant_sale_payment_verifications_amount_check
    check (amount_cents>0 and amount_cents<=1000000000),
  constraint merchant_sale_payment_verifications_currency_check
    check (currency='BRL'),
  constraint merchant_sale_payment_verifications_status_check
    check (status in ('observed','verified','rejected','review_required')),
  constraint merchant_sale_payment_verifications_hash_check
    check (evidence_sha256 ~ '^[0-9a-f]{64}$'),
  constraint merchant_sale_payment_verifications_transaction_check
    check (
      provider_transaction_id is null
      or (
        char_length(provider_transaction_id) between 1 and 240
        and provider_transaction_id !~ '[[:cntrl:]]'
      )
    ),
  constraint merchant_sale_payment_verifications_funds_owner_check
    check (funds_owner='merchant')
);

create index if not exists merchant_sale_payment_verifications_order_idx
  on public.merchant_sale_payment_verifications(order_id,created_at desc);
create index if not exists merchant_sale_payment_verifications_merchant_provider_idx
  on public.merchant_sale_payment_verifications(merchant_id,provider,created_at desc);
create index if not exists merchant_sale_payment_verifications_attempt_idx
  on public.merchant_sale_payment_verifications(payment_attempt_id,created_at desc)
  where payment_attempt_id is not null;
create unique index if not exists merchant_sale_payment_verifications_provider_tx_unique
  on public.merchant_sale_payment_verifications(merchant_id,provider,provider_transaction_id,verification_level)
  where provider_transaction_id is not null and status='verified';

alter table public.merchant_sale_payment_verifications enable row level security;
revoke all on table public.merchant_sale_payment_verifications from public,anon,authenticated;
grant select,insert,update,delete on table public.merchant_sale_payment_verifications to service_role;

create or replace function public.merchant_payment_routes_action(
  p_actor_user_id uuid,
  p_merchant_id uuid,
  p_expected_version integer,
  p_routes jsonb,
  p_reason text,
  p_idempotency_key text,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_role text;
  v_action public.action_requests%rowtype;
  v_set public.merchant_payment_route_sets%rowtype;
  v_route jsonb;
  v_provider public.payment_provider_catalog%rowtype;
  v_connection public.merchant_payment_provider_accounts%rowtype;
  v_method text;
  v_provider_key text;
  v_channel text;
  v_verification text;
  v_connection_id uuid;
  v_active boolean;
  v_priority integer;
  v_label text;
  v_reason text:=trim(regexp_replace(coalesce(p_reason,''),'\s+',' ','g'));
  v_routes jsonb;
  v_result jsonb;
  v_count integer;
begin
  select member_role
  into v_role
  from public.merchant_members
  where merchant_id=p_merchant_id
    and user_id=p_actor_user_id
    and active
  for share;

  if v_role not in ('owner','manager') then
    raise exception 'MERCHANT_PAYMENT_PERMISSION_DENIED' using errcode='42501';
  end if;

  if p_expected_version is null or p_expected_version<1 then
    raise exception 'PAYMENT_ROUTE_VERSION_REQUIRED' using errcode='22023';
  end if;
  if p_routes is null or jsonb_typeof(p_routes)<>'array' then
    raise exception 'PAYMENT_ROUTES_ARRAY_REQUIRED' using errcode='22023';
  end if;
  v_count:=jsonb_array_length(p_routes);
  if v_count<1 or v_count>30 then
    raise exception 'PAYMENT_ROUTES_COUNT_INVALID' using errcode='22023';
  end if;
  if char_length(v_reason)<3 or char_length(v_reason)>1000 then
    raise exception 'PAYMENT_ROUTE_REASON_REQUIRED' using errcode='22023';
  end if;
  if p_idempotency_key is null
     or char_length(p_idempotency_key)<12
     or char_length(p_idempotency_key)>120 then
    raise exception 'INVALID_IDEMPOTENCY_KEY' using errcode='22023';
  end if;
  if p_request_hash is null or p_request_hash!~'^[0-9a-f]{64}$' then
    raise exception 'INVALID_REQUEST_HASH' using errcode='22023';
  end if;

  insert into public.action_requests(idempotency_key,user_id,action_name,request_hash)
  values(p_idempotency_key,p_actor_user_id,'merchant-payment-routes:update',p_request_hash)
  on conflict(idempotency_key) do nothing;

  select *
  into v_action
  from public.action_requests
  where idempotency_key=p_idempotency_key
  for update;

  if not found
     or v_action.user_id<>p_actor_user_id
     or v_action.action_name<>'merchant-payment-routes:update'
     or v_action.request_hash<>p_request_hash then
    raise exception 'IDEMPOTENCY_CONFLICT' using errcode='23505';
  end if;
  if v_action.completed_at is not null then
    return v_action.result_json;
  end if;

  insert into public.merchant_payment_route_sets(merchant_id,version,updated_by,updated_at)
  values(p_merchant_id,1,p_actor_user_id,clock_timestamp())
  on conflict(merchant_id) do nothing;

  select *
  into v_set
  from public.merchant_payment_route_sets
  where merchant_id=p_merchant_id
  for update;

  if v_set.version<>p_expected_version then
    raise exception 'PAYMENT_ROUTE_VERSION_CONFLICT' using errcode='40001';
  end if;

  for v_route in select value from jsonb_array_elements(p_routes)
  loop
    if jsonb_typeof(v_route)<>'object' then
      raise exception 'PAYMENT_ROUTE_INVALID' using errcode='22023';
    end if;
    v_method:=lower(trim(coalesce(v_route->>'paymentMethod','')));
    v_provider_key:=lower(trim(coalesce(v_route->>'provider','')));
    v_channel:=lower(trim(coalesce(v_route->>'channel','')));
    v_verification:=lower(trim(coalesce(v_route->>'verificationMode','')));
    v_active:=coalesce((v_route->>'active')::boolean,true);
    v_priority:=coalesce((v_route->>'priority')::integer,100);
    v_label:=nullif(trim(coalesce(v_route->>'customerLabel','')),'');
    begin
      v_connection_id:=nullif(trim(coalesce(v_route->>'connectionId','')),'')::uuid;
    exception when invalid_text_representation then
      raise exception 'PAYMENT_ROUTE_CONNECTION_INVALID' using errcode='22023';
    end;

    if v_method not in ('pix','card','card_credit','card_debit','cash','bank_transfer','payment_link')
       or v_channel not in ('online','delivery','external')
       or v_verification not in ('provider_api','device','merchant_confirmed','customer_receipt')
       or v_priority<1 or v_priority>1000 then
      raise exception 'PAYMENT_ROUTE_INVALID' using errcode='22023';
    end if;
    if v_label is not null and (
      char_length(v_label)<2 or char_length(v_label)>80 or v_label~'[[:cntrl:]]'
    ) then
      raise exception 'PAYMENT_ROUTE_LABEL_INVALID' using errcode='22023';
    end if;

    select *
    into v_provider
    from public.payment_provider_catalog
    where provider_key=v_provider_key
    for share;
    if not found then
      raise exception 'PAYMENT_PROVIDER_INVALID' using errcode='22023';
    end if;
    if not (v_provider.supported_methods ? v_method) then
      raise exception 'PAYMENT_PROVIDER_METHOD_UNSUPPORTED' using errcode='22023';
    end if;

    if v_verification in ('provider_api','device') then
      if v_connection_id is null then
        raise exception 'PAYMENT_ROUTE_CONNECTION_REQUIRED' using errcode='22023';
      end if;
      select *
      into v_connection
      from public.merchant_payment_provider_accounts
      where id=v_connection_id
      for share;
      if not found
         or v_connection.merchant_id<>p_merchant_id
         or v_connection.provider<>v_provider_key
         or v_connection.status<>'active' then
        raise exception 'PAYMENT_ROUTE_CONNECTION_MISMATCH' using errcode='40001';
      end if;
      if coalesce((v_connection.capabilities->>'canValidateProviderTransactions')::boolean,false)<>true
         or coalesce((v_connection.capabilities->>'directSalePaymentsEnabled')::boolean,false)<>true then
        raise exception 'PAYMENT_ROUTE_NOT_HOMOLOGATED' using errcode='40001';
      end if;
    elsif v_connection_id is not null then
      select *
      into v_connection
      from public.merchant_payment_provider_accounts
      where id=v_connection_id
      for share;
      if not found
         or v_connection.merchant_id<>p_merchant_id
         or v_connection.provider<>v_provider_key then
        raise exception 'PAYMENT_ROUTE_CONNECTION_MISMATCH' using errcode='40001';
      end if;
    end if;
  end loop;

  if exists(
    select 1
    from (
      select
        lower(trim(value->>'paymentMethod')) payment_method,
        lower(trim(value->>'provider')) provider,
        lower(trim(value->>'channel')) channel,
        count(*) n
      from jsonb_array_elements(p_routes)
      group by 1,2,3
      having count(*)>1
    ) d
  ) then
    raise exception 'PAYMENT_ROUTE_DUPLICATE' using errcode='23505';
  end if;

  delete from public.merchant_payment_routes
  where merchant_id=p_merchant_id;

  for v_route in select value from jsonb_array_elements(p_routes)
  loop
    v_method:=lower(trim(v_route->>'paymentMethod'));
    v_provider_key:=lower(trim(v_route->>'provider'));
    v_channel:=lower(trim(v_route->>'channel'));
    v_verification:=lower(trim(v_route->>'verificationMode'));
    v_active:=coalesce((v_route->>'active')::boolean,true);
    v_priority:=coalesce((v_route->>'priority')::integer,100);
    v_label:=nullif(trim(coalesce(v_route->>'customerLabel','')),'');
    v_connection_id:=nullif(trim(coalesce(v_route->>'connectionId','')),'')::uuid;

    insert into public.merchant_payment_routes(
      merchant_id,payment_method,provider,connection_id,channel,
      verification_mode,active,priority,customer_label,metadata,confirmed_at
    )
    values(
      p_merchant_id,v_method,v_provider_key,v_connection_id,v_channel,
      v_verification,v_active,v_priority,v_label,
      case when jsonb_typeof(v_route->'metadata')='object'
        then v_route->'metadata' else '{}'::jsonb end,
      case when v_active then clock_timestamp() else null end
    );
  end loop;

  insert into public.merchant_payment_methods(merchant_id,payment_method,active,confirmed_at,updated_at)
  values
    (
      p_merchant_id,'pix',
      exists(select 1 from public.merchant_payment_routes where merchant_id=p_merchant_id and active and payment_method='pix'),
      case when exists(select 1 from public.merchant_payment_routes where merchant_id=p_merchant_id and active and payment_method='pix') then clock_timestamp() else null end,
      clock_timestamp()
    ),
    (
      p_merchant_id,'card',
      exists(select 1 from public.merchant_payment_routes where merchant_id=p_merchant_id and active and payment_method in ('card','card_credit','card_debit')),
      case when exists(select 1 from public.merchant_payment_routes where merchant_id=p_merchant_id and active and payment_method in ('card','card_credit','card_debit')) then clock_timestamp() else null end,
      clock_timestamp()
    ),
    (
      p_merchant_id,'cash',
      exists(select 1 from public.merchant_payment_routes where merchant_id=p_merchant_id and active and payment_method='cash'),
      case when exists(select 1 from public.merchant_payment_routes where merchant_id=p_merchant_id and active and payment_method='cash') then clock_timestamp() else null end,
      clock_timestamp()
    )
  on conflict(merchant_id,payment_method) do update set
    active=excluded.active,
    confirmed_at=excluded.confirmed_at,
    updated_at=excluded.updated_at;

  update public.merchant_payment_route_sets
  set version=version+1,
      updated_by=p_actor_user_id,
      updated_at=clock_timestamp()
  where merchant_id=p_merchant_id
  returning * into v_set;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id',r.id,
      'paymentMethod',r.payment_method,
      'provider',r.provider,
      'connectionId',r.connection_id,
      'channel',r.channel,
      'verificationMode',r.verification_mode,
      'active',r.active,
      'priority',r.priority,
      'customerLabel',r.customer_label,
      'metadata',r.metadata
    )
    order by r.priority,r.payment_method,r.provider,r.id
  ),'[]'::jsonb)
  into v_routes
  from public.merchant_payment_routes r
  where r.merchant_id=p_merchant_id;

  insert into public.merchant_payment_route_history(
    merchant_id,version,routes_snapshot,changed_by,change_reason,changed_at
  )
  values(
    p_merchant_id,v_set.version,v_routes,p_actor_user_id,v_reason,v_set.updated_at
  );

  v_result:=jsonb_build_object(
    'ok',true,
    'merchantId',p_merchant_id,
    'version',v_set.version,
    'fundsOwner','merchant',
    'tamaoReceivesSaleProceeds',false,
    'routes',v_routes
  );

  update public.action_requests
  set result_json=v_result,completed_at=clock_timestamp()
  where idempotency_key=p_idempotency_key;

  return v_result;
end;
$function$;

revoke all on function public.merchant_payment_routes_action(
  uuid,uuid,integer,jsonb,text,text,text
) from public,anon,authenticated;
grant execute on function public.merchant_payment_routes_action(
  uuid,uuid,integer,jsonb,text,text,text
) to service_role;

create or replace function public.apply_merchant_sale_payment_event_v2(
  p_provider text,
  p_provider_event_id text,
  p_provider_order_id text,
  p_provider_payment_id text,
  p_event_type text,
  p_normalized_status text,
  p_amount_cents bigint,
  p_currency text,
  p_occurred_at timestamptz,
  p_raw_payload_sha256 text,
  p_evidence_type text default 'provider_webhook'
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_provider text:=lower(trim(coalesce(p_provider,'')));
  v_event_id text:=trim(coalesce(p_provider_event_id,''));
  v_order_id text:=trim(coalesce(p_provider_order_id,''));
  v_payment_id text:=nullif(trim(coalesce(p_provider_payment_id,'')),'');
  v_event_type text:=trim(coalesce(p_event_type,''));
  v_status text:=lower(trim(coalesce(p_normalized_status,'')));
  v_currency text:=upper(trim(coalesce(p_currency,'')));
  v_hash text:=lower(trim(coalesce(p_raw_payload_sha256,'')));
  v_evidence text:=lower(trim(coalesce(p_evidence_type,'')));
  v_attempt public.merchant_sale_payment_attempts%rowtype;
  v_existing public.merchant_sale_payment_events%rowtype;
  v_next_status text;
  v_now timestamptz:=clock_timestamp();
begin
  if not exists(select 1 from public.payment_provider_catalog where provider_key=v_provider) then
    raise exception 'PAYMENT_PROVIDER_INVALID' using errcode='22023';
  end if;
  if char_length(v_event_id)<6 or char_length(v_event_id)>200
     or v_event_id~'[[:cntrl:]]'
     or char_length(v_order_id)<1 or char_length(v_order_id)>240
     or v_order_id~'[[:cntrl:]]'
     or char_length(v_event_type)<3 or char_length(v_event_type)>120
     or v_event_type!~'^[A-Za-z0-9._:-]+$'
     or v_hash!~'^[0-9a-f]{64}$'
     or p_amount_cents is null or p_amount_cents<=0
     or v_currency<>'BRL'
     or v_status not in ('approved','processed','pending','refunded','partially_refunded','expired','cancelled','canceled','rejected','failed')
     or v_evidence not in ('provider_webhook','provider_api','terminal') then
    raise exception 'INVALID_SALE_PAYMENT_EVENT' using errcode='22023';
  end if;

  select *
  into v_attempt
  from public.merchant_sale_payment_attempts
  where provider=v_provider
    and provider_order_id=v_order_id
  for update;

  if not found then
    raise exception 'SALE_PAYMENT_PROVIDER_ORDER_NOT_FOUND' using errcode='P0002';
  end if;

  if v_attempt.amount_cents<>p_amount_cents
     or v_attempt.currency<>v_currency
     or v_attempt.funds_owner<>'merchant' then
    update public.merchant_sale_payment_attempts
    set status='review_required',
        last_error_code='PROVIDER_AMOUNT_OR_OWNERSHIP_MISMATCH',
        last_error_at=v_now,
        updated_at=v_now
    where id=v_attempt.id;
    raise exception 'SALE_PAYMENT_AMOUNT_MISMATCH' using errcode='40001';
  end if;

  select *
  into v_existing
  from public.merchant_sale_payment_events
  where provider=v_provider
    and provider_event_id=v_event_id
  for update;

  if found then
    if v_existing.raw_payload_sha256<>v_hash
       or v_existing.payment_attempt_id is distinct from v_attempt.id then
      raise exception 'SALE_PAYMENT_EVENT_ID_CONFLICT' using errcode='23505';
    end if;
    return jsonb_build_object(
      'ok',true,'replayed',true,'provider',v_provider,
      'attemptId',v_attempt.id,'orderId',v_attempt.order_id,
      'status',v_attempt.status,'fundsOwner','merchant',
      'tamaoReceivesSaleProceeds',false
    );
  end if;

  v_next_status:=case
    when v_status in ('approved','processed') then 'approved'
    when v_status='refunded' then 'refunded'
    when v_status='partially_refunded' then 'review_required'
    when v_status='expired' then 'expired'
    when v_status in ('cancelled','canceled') then 'cancelled'
    when v_status in ('rejected','failed') then 'rejected'
    else 'pending'
  end;

  insert into public.merchant_sale_payment_events(
    provider,provider_event_id,payment_attempt_id,provider_payment_id,
    event_type,event_status,raw_payload_sha256,occurred_at,processed_at,
    verification_level,evidence_type,funds_owner
  )
  values(
    v_provider,v_event_id,v_attempt.id,v_payment_id,
    v_event_type,
    case when v_next_status='review_required' then 'review_required' else 'applied' end,
    v_hash,coalesce(p_occurred_at,v_now),v_now,
    v_attempt.verification_level,v_evidence,'merchant'
  );

  if v_next_status='approved' then
    if v_payment_id is null then
      update public.merchant_sale_payment_attempts
      set status='review_required',
          last_error_code='PROVIDER_PAYMENT_ID_MISSING',
          last_error_at=v_now,
          updated_at=v_now
      where id=v_attempt.id
        and status<>'refunded';
    else
      update public.merchant_sale_payment_attempts
      set status='approved',
          provider_payment_id=coalesce(provider_payment_id,v_payment_id),
          provider_status=v_status,
          approved_at=coalesce(approved_at,coalesce(p_occurred_at,v_now)),
          updated_at=v_now,
          last_error_code=null,
          last_error_at=null
      where id=v_attempt.id
        and status not in ('refunded','review_required');

      insert into public.merchant_sale_payment_verifications(
        order_id,payment_attempt_id,merchant_id,provider,
        verification_level,evidence_type,provider_transaction_id,
        amount_cents,currency,status,evidence_sha256,funds_owner,
        occurred_at,verified_at,metadata
      )
      values(
        v_attempt.order_id,v_attempt.id,v_attempt.merchant_id,v_provider,
        v_attempt.verification_level,v_evidence,v_payment_id,
        v_attempt.amount_cents,'BRL','verified',v_hash,'merchant',
        coalesce(p_occurred_at,v_now),v_now,
        jsonb_build_object('providerOrderId',v_order_id,'eventType',v_event_type)
      )
      on conflict do nothing;
    end if;
  elsif v_next_status='refunded' then
    update public.merchant_sale_payment_attempts
    set status='refunded',
        provider_payment_id=coalesce(provider_payment_id,v_payment_id),
        provider_status=v_status,
        refunded_at=coalesce(refunded_at,coalesce(p_occurred_at,v_now)),
        updated_at=v_now
    where id=v_attempt.id
      and status in ('approved','refunded');
  elsif v_next_status='review_required' then
    update public.merchant_sale_payment_attempts
    set status='review_required',
        provider_payment_id=coalesce(provider_payment_id,v_payment_id),
        provider_status=v_status,
        last_error_code='PARTIAL_REFUND_REVIEW_REQUIRED',
        last_error_at=v_now,
        updated_at=v_now
    where id=v_attempt.id
      and status<>'refunded';
  elsif v_next_status in ('expired','cancelled','rejected') then
    update public.merchant_sale_payment_attempts
    set status=v_next_status,
        provider_payment_id=coalesce(provider_payment_id,v_payment_id),
        provider_status=v_status,
        rejected_at=case when v_next_status='rejected' then coalesce(rejected_at,coalesce(p_occurred_at,v_now)) else rejected_at end,
        cancelled_at=case when v_next_status='cancelled' then coalesce(cancelled_at,coalesce(p_occurred_at,v_now)) else cancelled_at end,
        updated_at=v_now
    where id=v_attempt.id
      and status not in ('approved','refunded','review_required');
  else
    update public.merchant_sale_payment_attempts
    set status=case when status='preparing' then 'pending' else status end,
        provider_payment_id=coalesce(provider_payment_id,v_payment_id),
        provider_status=v_status,
        updated_at=v_now
    where id=v_attempt.id
      and status not in ('approved','refunded','review_required');
  end if;

  select *
  into v_attempt
  from public.merchant_sale_payment_attempts
  where id=v_attempt.id;

  return jsonb_build_object(
    'ok',true,'replayed',false,'provider',v_provider,
    'attemptId',v_attempt.id,'orderId',v_attempt.order_id,
    'merchantId',v_attempt.merchant_id,'status',v_attempt.status,
    'providerStatus',v_attempt.provider_status,
    'verificationLevel',v_attempt.verification_level,
    'fundsOwner','merchant','tamaoReceivesSaleProceeds',false
  );
end;
$function$;

revoke all on function public.apply_merchant_sale_payment_event_v2(
  text,text,text,text,text,text,bigint,text,timestamptz,text,text
) from public,anon,authenticated;
grant execute on function public.apply_merchant_sale_payment_event_v2(
  text,text,text,text,text,text,bigint,text,timestamptz,text,text
) to service_role;

create or replace function public.apply_merchant_sale_payment_event(
  p_provider_event_id text,
  p_provider_order_id text,
  p_provider_payment_id text,
  p_event_type text,
  p_provider_status text,
  p_amount_cents bigint,
  p_currency text,
  p_occurred_at timestamptz,
  p_raw_payload_sha256 text
)
returns jsonb
language sql
security definer
set search_path to 'pg_catalog'
as $function$
  select public.apply_merchant_sale_payment_event_v2(
    'mercadopago',
    p_provider_event_id,
    p_provider_order_id,
    p_provider_payment_id,
    p_event_type,
    case
      when lower(trim(coalesce(p_provider_status,'')))='processed' then 'processed'
      when lower(trim(coalesce(p_provider_status,'')))='approved' then 'approved'
      when lower(trim(coalesce(p_provider_status,''))) in ('refunded','partially_refunded') then lower(trim(p_provider_status))
      when lower(trim(coalesce(p_provider_status,'')))='expired' then 'expired'
      when lower(trim(coalesce(p_provider_status,''))) in ('canceled','cancelled') then 'cancelled'
      when lower(trim(coalesce(p_provider_status,''))) in ('failed','rejected') then 'rejected'
      else 'pending'
    end,
    p_amount_cents,p_currency,p_occurred_at,p_raw_payload_sha256,
    'provider_webhook'
  );
$function$;

revoke all on function public.apply_merchant_sale_payment_event(
  text,text,text,text,text,bigint,text,timestamptz,text
) from public,anon,authenticated;
grant execute on function public.apply_merchant_sale_payment_event(
  text,text,text,text,text,bigint,text,timestamptz,text
) to service_role;

create or replace function public.disconnect_merchant_payment_provider_account(
  p_actor_user_id uuid,
  p_merchant_id uuid,
  p_provider text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_role text;
  v_provider text:=lower(trim(coalesce(p_provider,'')));
  v_account public.merchant_payment_provider_accounts%rowtype;
begin
  if not exists(
    select 1 from public.payment_provider_catalog
    where provider_key=v_provider and provider_key<>'manual'
  ) then
    raise exception 'PAYMENT_PROVIDER_INVALID' using errcode='22023';
  end if;

  select member_role
  into v_role
  from public.merchant_members
  where merchant_id=p_merchant_id
    and user_id=p_actor_user_id
    and active
  for share;

  if v_role not in ('owner','manager') then
    raise exception 'MERCHANT_PAYMENT_PERMISSION_DENIED' using errcode='42501';
  end if;

  if exists(
    select 1
    from public.merchant_sale_payment_attempts a
    join public.orders o on o.id=a.order_id
    where a.merchant_id=p_merchant_id
      and a.provider=v_provider
      and (
        a.status in ('preparing','checkout_ready','pending','review_required')
        or (a.status='approved' and o.status<>'SETTLED')
      )
  ) then
    raise exception 'PAYMENT_CONNECTION_HAS_LIVE_ATTEMPTS' using errcode='40001';
  end if;

  if exists(
    select 1 from public.merchant_payment_routes r
    where r.merchant_id=p_merchant_id
      and r.provider=v_provider
      and r.active
      and r.verification_mode in ('provider_api','device')
  ) then
    raise exception 'PAYMENT_CONNECTION_HAS_ACTIVE_ROUTES' using errcode='40001';
  end if;

  update public.merchant_payment_provider_accounts
  set status='revoked',
      access_token_ciphertext=null,
      access_token_nonce=null,
      refresh_token_ciphertext=null,
      refresh_token_nonce=null,
      credential_bundle_ciphertext=null,
      credential_bundle_nonce=null,
      token_expires_at=null,
      revoked_at=clock_timestamp(),
      updated_at=clock_timestamp()
  where merchant_id=p_merchant_id
    and provider=v_provider
  returning * into v_account;

  if not found then
    return jsonb_build_object(
      'ok',true,'merchantId',p_merchant_id,'provider',v_provider,
      'status','not_connected','fundsOwner','merchant'
    );
  end if;

  return jsonb_build_object(
    'ok',true,'merchantId',v_account.merchant_id,'provider',v_account.provider,
    'status',v_account.status,'revokedAt',v_account.revoked_at,
    'fundsOwner','merchant','tamaoReceivesSaleProceeds',false
  );
end;
$function$;

revoke all on function public.disconnect_merchant_payment_provider_account(
  uuid,uuid,text
) from public,anon,authenticated;
grant execute on function public.disconnect_merchant_payment_provider_account(
  uuid,uuid,text
) to service_role;

create or replace function public.admin_merchant_provider_payment_capability_action(
  p_actor_user_id uuid,
  p_merchant_id uuid,
  p_provider text,
  p_enabled boolean,
  p_reference text,
  p_idempotency_key text,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_role text;
  v_provider text:=lower(trim(coalesce(p_provider,'')));
  v_action public.action_requests%rowtype;
  v_account public.merchant_payment_provider_accounts%rowtype;
  v_reference text:=trim(coalesce(p_reference,''));
  v_changed_at timestamptz:=clock_timestamp();
  v_capabilities jsonb;
  v_result jsonb;
begin
  v_role:=public.platform_admin_role(p_actor_user_id);
  if v_role not in ('superadmin','finance') then
    raise exception 'ADMIN_PERMISSION_DENIED' using errcode='42501';
  end if;
  if p_merchant_id is null or p_enabled is null
     or not exists(
       select 1 from public.payment_provider_catalog
       where provider_key=v_provider
         and provider_key<>'manual'
         and (
           p_enabled is false
           or adapter_status='implemented'
         )
     ) then
    raise exception 'INVALID_MERCHANT_PAYMENT_CAPABILITY' using errcode='22023';
  end if;
  if char_length(v_reference)<3 or char_length(v_reference)>240
     or v_reference~'[[:cntrl:]]' then
    raise exception 'MERCHANT_PAYMENT_CAPABILITY_REFERENCE_REQUIRED' using errcode='22023';
  end if;
  if p_idempotency_key is null
     or char_length(p_idempotency_key)<12
     or char_length(p_idempotency_key)>120 then
    raise exception 'INVALID_IDEMPOTENCY_KEY' using errcode='22023';
  end if;
  if p_request_hash is null or p_request_hash!~'^[0-9a-f]{64}$' then
    raise exception 'INVALID_REQUEST_HASH' using errcode='22023';
  end if;

  insert into public.action_requests(idempotency_key,user_id,action_name,request_hash)
  values(
    p_idempotency_key,p_actor_user_id,
    'admin-ops:merchant-payment-capability:'||v_provider,p_request_hash
  )
  on conflict(idempotency_key) do nothing;

  select *
  into v_action
  from public.action_requests
  where idempotency_key=p_idempotency_key
  for update;

  if not found
     or v_action.user_id<>p_actor_user_id
     or v_action.action_name<>'admin-ops:merchant-payment-capability:'||v_provider
     or v_action.request_hash<>p_request_hash then
    raise exception 'IDEMPOTENCY_CONFLICT' using errcode='23505';
  end if;
  if v_action.completed_at is not null then
    return v_action.result_json;
  end if;

  select *
  into v_account
  from public.merchant_payment_provider_accounts
  where merchant_id=p_merchant_id
    and provider=v_provider
  for update;

  if not found then
    raise exception 'MERCHANT_PAYMENT_ACCOUNT_NOT_CONNECTED' using errcode='P0002';
  end if;

  if p_enabled then
    if v_account.status<>'active'
       or v_account.provider_account_id is null
       or coalesce((v_account.capabilities->>'canValidateProviderTransactions')::boolean,false)<>true then
      raise exception 'MERCHANT_PAYMENT_ACCOUNT_NOT_READY' using errcode='40001';
    end if;
    if exists(
      select 1
      from public.merchant_sale_payment_attempts
      where merchant_id=p_merchant_id
        and provider=v_provider
        and status='review_required'
    ) then
      raise exception 'MERCHANT_PAYMENT_REVIEW_REQUIRED' using errcode='40001';
    end if;
  end if;

  v_capabilities:=
    coalesce(v_account.capabilities,'{}'::jsonb)
    ||jsonb_build_object(
      'directSalePaymentsEnabled',p_enabled,
      'directSalePaymentApproval',jsonb_build_object(
        'enabled',p_enabled,'changedAt',v_changed_at,
        'changedBy',p_actor_user_id,'reference',v_reference
      )
    );

  update public.merchant_payment_provider_accounts
  set capabilities=v_capabilities,updated_at=v_changed_at
  where id=v_account.id
  returning * into v_account;

  insert into public.platform_admin_audit(
    actor_user_id,action,target_type,target_id,metadata
  )
  values(
    p_actor_user_id,
    case when p_enabled
      then 'enable_merchant_direct_payment'
      else 'disable_merchant_direct_payment'
    end,
    'merchant',
    p_merchant_id::text,
    jsonb_build_object(
      'provider',v_provider,'enabled',p_enabled,'reference',v_reference,
      'providerAccountId',v_account.provider_account_id,
      'connectionStatus',v_account.status,
      'fundsOwner','merchant','tamaoReceivesSaleProceeds',false
    )
  );

  v_result:=jsonb_build_object(
    'ok',true,'merchantId',p_merchant_id,'provider',v_provider,
    'enabled',p_enabled,'connectionStatus',v_account.status,
    'changedAt',v_changed_at,'reference',v_reference,
    'fundsOwner','merchant','tamaoReceivesSaleProceeds',false
  );

  update public.action_requests
  set result_json=v_result,completed_at=v_changed_at
  where idempotency_key=p_idempotency_key;

  return v_result;
end;
$function$;

revoke all on function public.admin_merchant_provider_payment_capability_action(
  uuid,uuid,text,boolean,text,text,text
) from public,anon,authenticated;
grant execute on function public.admin_merchant_provider_payment_capability_action(
  uuid,uuid,text,boolean,text,text,text
) to service_role;

create or replace function public.admin_merchant_payment_capability_action(
  p_actor_user_id uuid,
  p_merchant_id uuid,
  p_enabled boolean,
  p_reference text,
  p_idempotency_key text,
  p_request_hash text
)
returns jsonb
language sql
security definer
set search_path to 'pg_catalog'
as $function$
  select public.admin_merchant_provider_payment_capability_action(
    p_actor_user_id,p_merchant_id,'mercadopago',p_enabled,p_reference,
    p_idempotency_key,p_request_hash
  );
$function$;

revoke all on function public.admin_merchant_payment_capability_action(
  uuid,uuid,boolean,text,text,text
) from public,anon,authenticated;
grant execute on function public.admin_merchant_payment_capability_action(
  uuid,uuid,boolean,text,text,text
) to service_role;

create or replace function public.prepare_merchant_sale_payment_attempt_v2(
  p_actor_user_id uuid,
  p_order_id uuid,
  p_payment_route_id uuid,
  p_idempotency_key text,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_order public.orders%rowtype;
  v_route public.merchant_payment_routes%rowtype;
  v_account public.merchant_payment_provider_accounts%rowtype;
  v_action public.action_requests%rowtype;
  v_attempt public.merchant_sale_payment_attempts%rowtype;
  v_external_reference text;
  v_checkout_mode text;
  v_verification_level text;
  v_result jsonb;
begin
  if p_actor_user_id is null or p_order_id is null or p_payment_route_id is null then
    raise exception 'SALE_PAYMENT_ROUTE_REQUIRED' using errcode='22023';
  end if;
  if p_idempotency_key is null
     or char_length(p_idempotency_key)<12
     or char_length(p_idempotency_key)>120 then
    raise exception 'INVALID_IDEMPOTENCY_KEY' using errcode='22023';
  end if;
  if p_request_hash is null or p_request_hash!~'^[0-9a-f]{64}$' then
    raise exception 'INVALID_REQUEST_HASH' using errcode='22023';
  end if;

  insert into public.action_requests(idempotency_key,user_id,action_name,request_hash)
  values(p_idempotency_key,p_actor_user_id,'merchant-sale-payment:prepare:v2',p_request_hash)
  on conflict(idempotency_key) do nothing;

  select * into v_action
  from public.action_requests
  where idempotency_key=p_idempotency_key
  for update;

  if not found
     or v_action.user_id<>p_actor_user_id
     or v_action.action_name<>'merchant-sale-payment:prepare:v2'
     or v_action.request_hash<>p_request_hash then
    raise exception 'IDEMPOTENCY_CONFLICT' using errcode='23505';
  end if;
  if v_action.completed_at is not null then
    return v_action.result_json;
  end if;

  select * into v_order
  from public.orders
  where id=p_order_id
  for update;

  if not found or v_order.customer_id<>p_actor_user_id then
    raise exception 'ORDER_NOT_FOUND' using errcode='P0002';
  end if;
  if v_order.merchant_id is null then
    raise exception 'ORDER_MERCHANT_NOT_BOUND' using errcode='40001';
  end if;
  if v_order.status not in ('MERCHANT_ACCEPTED','PREPARING','AT_RISK','OUT_FOR_DELIVERY','ARRIVING') then
    raise exception 'ORDER_NOT_PAYABLE' using errcode='40001';
  end if;
  if v_order.total_cents<=0 then
    raise exception 'ORDER_PAYMENT_AMOUNT_INVALID' using errcode='40001';
  end if;

  select * into v_route
  from public.merchant_payment_routes
  where id=p_payment_route_id
    and merchant_id=v_order.merchant_id
    and active
  for share;

  if not found then
    raise exception 'PAYMENT_ROUTE_NOT_AVAILABLE' using errcode='40001';
  end if;
  if v_route.verification_mode not in ('provider_api','device') then
    raise exception 'PAYMENT_ROUTE_NOT_AUTOMATED' using errcode='40001';
  end if;
  if v_route.connection_id is null then
    raise exception 'PAYMENT_ROUTE_CONNECTION_REQUIRED' using errcode='40001';
  end if;

  select * into v_account
  from public.merchant_payment_provider_accounts
  where id=v_route.connection_id
    and merchant_id=v_order.merchant_id
    and provider=v_route.provider
  for share;

  if not found
     or v_account.status<>'active'
     or coalesce((v_account.capabilities->>'directSalePaymentsEnabled')::boolean,false)<>true
     or coalesce((v_account.capabilities->>'canValidateProviderTransactions')::boolean,false)<>true then
    raise exception 'MERCHANT_DIRECT_PAYMENT_NOT_ENABLED' using errcode='40001';
  end if;

  if not (
    v_order.payment_method=v_route.payment_method
    or (v_order.payment_method='card' and v_route.payment_method in ('card','card_credit','card_debit'))
  ) then
    raise exception 'ORDER_PAYMENT_ROUTE_MISMATCH' using errcode='40001';
  end if;

  select * into v_attempt
  from public.merchant_sale_payment_attempts
  where order_id=v_order.id
    and status in ('preparing','checkout_ready','pending','approved','review_required')
  order by
    case status when 'approved' then 0 when 'review_required' then 1 when 'checkout_ready' then 2 else 3 end,
    created_at desc
  limit 1
  for update;

  if not found then
    v_external_reference:=gen_random_uuid()::text;
    v_checkout_mode:=case
      when v_route.verification_mode='device' then 'terminal'
      when v_route.payment_method='pix' then 'pix'
      when v_route.payment_method='payment_link' then 'external_link'
      else 'hosted'
    end;
    v_verification_level:=case
      when v_route.verification_mode='device' then 'device'
      else 'provider'
    end;

    insert into public.merchant_sale_payment_attempts(
      order_id,merchant_id,provider,checkout_mode,external_reference,
      amount_cents,currency,status,payment_route_id,payment_method_snapshot,
      verification_level,funds_owner
    )
    values(
      v_order.id,v_order.merchant_id,v_route.provider,v_checkout_mode,
      v_external_reference,v_order.total_cents,'BRL','preparing',
      v_route.id,v_route.payment_method,v_verification_level,'merchant'
    )
    returning * into v_attempt;
  end if;

  v_result:=jsonb_build_object(
    'ok',true,'attemptId',v_attempt.id,'orderId',v_attempt.order_id,
    'merchantId',v_attempt.merchant_id,'provider',v_attempt.provider,
    'paymentRouteId',v_attempt.payment_route_id,
    'paymentMethod',v_attempt.payment_method_snapshot,
    'verificationLevel',v_attempt.verification_level,
    'externalReference',v_attempt.external_reference,
    'amountCents',v_attempt.amount_cents,'currency',v_attempt.currency,
    'status',v_attempt.status,'providerOrderId',v_attempt.provider_order_id,
    'checkoutUrl',v_attempt.checkout_url,'expiresAt',v_attempt.expires_at,
    'fundsOwner','merchant','tamaoReceivesSaleProceeds',false
  );

  update public.action_requests
  set result_json=v_result,completed_at=clock_timestamp()
  where idempotency_key=p_idempotency_key;

  return v_result;
end;
$function$;

revoke all on function public.prepare_merchant_sale_payment_attempt_v2(
  uuid,uuid,uuid,text,text
) from public,anon,authenticated;
grant execute on function public.prepare_merchant_sale_payment_attempt_v2(
  uuid,uuid,uuid,text,text
) to service_role;


create or replace function public.record_order_payment_verification()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','extensions'
as $function$
declare
  v_attempt public.merchant_sale_payment_attempts%rowtype;
  v_level text;
  v_provider text;
  v_evidence_type text;
  v_transaction_id text;
  v_hash text;
begin
  if new.status<>'SETTLED'
     or new.payment_confirmed_at is null
     or old.payment_confirmed_at is not null then
    return new;
  end if;

  select *
  into v_attempt
  from public.merchant_sale_payment_attempts
  where order_id=new.id
    and merchant_id=new.merchant_id
    and amount_cents=new.total_cents
    and currency='BRL'
    and status='approved'
  order by approved_at asc nulls last,created_at asc,id
  limit 1;

  if found then
    if exists(
      select 1
      from public.merchant_sale_payment_verifications v
      where v.order_id=new.id
        and v.payment_attempt_id=v_attempt.id
        and v.status='verified'
    ) then
      return new;
    end if;
    v_level:=case when v_attempt.verification_level='device' then 'device' else 'provider' end;
    v_provider:=v_attempt.provider;
    v_evidence_type:=case when v_level='device' then 'terminal' else 'provider_api' end;
    v_transaction_id:=v_attempt.provider_payment_id;
  else
    v_level:='merchant';
    v_provider:='manual';
    v_evidence_type:='merchant_confirmation';
    v_transaction_id:=null;
  end if;

  v_hash:=encode(
    extensions.digest(
      convert_to(
        concat_ws('|',
          'tamao-payment-verification-v1',
          new.id::text,
          coalesce(new.merchant_id::text,''),
          v_provider,
          v_level,
          new.total_cents::text,
          new.payment_confirmed_at::text,
          coalesce(v_transaction_id,'')
        ),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  insert into public.merchant_sale_payment_verifications(
    order_id,payment_attempt_id,merchant_id,provider,
    verification_level,evidence_type,provider_transaction_id,
    amount_cents,currency,status,evidence_sha256,funds_owner,
    occurred_at,verified_at,metadata
  )
  values(
    new.id,
    case when found then v_attempt.id else null end,
    new.merchant_id,
    v_provider,
    v_level,
    v_evidence_type,
    v_transaction_id,
    new.total_cents,
    'BRL',
    'verified',
    v_hash,
    'merchant',
    new.payment_confirmed_at,
    clock_timestamp(),
    jsonb_build_object(
      'orderPaymentConfirmationMethod',new.payment_confirmation_method,
      'source','order_settlement'
    )
  )
  on conflict do nothing;

  return new;
end;
$function$;

revoke all on function public.record_order_payment_verification()
  from public,anon,authenticated;
grant execute on function public.record_order_payment_verification()
  to service_role;

drop trigger if exists record_order_payment_verification_trg on public.orders;
create trigger record_order_payment_verification_trg
after update of status,payment_confirmed_at
on public.orders
for each row
when (
  old.payment_confirmed_at is null
  and new.payment_confirmed_at is not null
  and new.status='SETTLED'
)
execute function public.record_order_payment_verification();
