-- TAMÃO Agenda V1.1052 — regras opcionais de sinal e motor financeiro FAIL-CLOSED.
-- Nenhum endpoint externo de cobrança é criado nesta etapa.
begin;

-- Agendamento gratuito segue funcionando sem PSP.
create table public.agenda_service_deposit_settings(
 service_id uuid primary key references public.agenda_services(id) on delete cascade,
 page_id uuid not null references public.agenda_pages(id) on delete cascade,
 owner_id uuid not null references auth.users(id),
 percent smallint not null default 0 check(percent in (0,10,20,25,30,50)),
 policy_text text not null default 'O sinal, quando disponível, abate do preço total. As condições de cancelamento e reembolso devem respeitar os direitos do consumidor.' check(length(policy_text) between 30 and 500),
 policy_version integer not null default 1 check(policy_version between 1 and 1000000),
 updated_at timestamptz not null default now()
);
alter table public.agenda_service_deposit_settings enable row level security;
revoke all on public.agenda_service_deposit_settings from public,anon,authenticated;
create policy agenda_deposit_settings_owner_read on public.agenda_service_deposit_settings
 for select to authenticated using(owner_id=(select auth.uid()));
grant select on public.agenda_service_deposit_settings to authenticated;

-- Programmatic test barriers; never authorize payment by a merchant flag
-- or another module's commerce switch. Any future activation is explicit.
create table public.agenda_payment_control(
 singleton boolean primary key default true check(singleton),
 charges_enabled boolean not null default false,
 oauth_recipient_homologated boolean not null default false,
 provider_webhook_homologated boolean not null default false,
 refunds_homologated boolean not null default false,
 reconciler_homologated boolean not null default false,
 live_finance_approved boolean not null default false,
 updated_at timestamptz not null default now(),
 constraint agenda_finance_no_partial_launch check(
  not charges_enabled or (
    oauth_recipient_homologated and provider_webhook_homologated and
    refunds_homologated and reconciler_homologated and live_finance_approved
  )
 )
);
insert into public.agenda_payment_control(singleton) values(true);
alter table public.agenda_payment_control enable row level security;
revoke all on public.agenda_payment_control from public,anon,authenticated;

-- Storage reserved for a future verified provider checkout. No browser grant
-- and no service creation without a provider recipient and explicit launch.
create table public.agenda_payment_holds(
 id uuid primary key default gen_random_uuid(),
 page_id uuid not null references public.agenda_pages(id),
 service_id uuid not null references public.agenda_services(id),
 staff_id uuid references public.agenda_staff(id),
 owner_id uuid not null references auth.users(id),
 customer_id uuid not null references auth.users(id),
 request_id uuid not null,
 starts_at timestamptz not null,
 ends_at timestamptz not null,
 expires_at timestamptz not null,
 snapshot_price_cents integer not null check(snapshot_price_cents between 100 and 2000000),
 snapshot_percent smallint not null check(snapshot_percent in (10,20,25,30,50)),
 deposit_cents integer not null check(deposit_cents>0),
 remaining_cents integer not null check(remaining_cents>=0),
 policy_version integer not null check(policy_version>0),
 provider text not null default 'mercadopago' check(provider='mercadopago'),
 recipient_provider_account_id text not null check(length(recipient_provider_account_id) between 3 and 160),
 status text not null default 'pending_payment'
  check(status in ('pending_payment','confirmed','expired','cancelled','refunding','refunded','failed')),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(customer_id,request_id),
 check(ends_at>starts_at),
 check(expires_at>created_at and expires_at<=created_at+interval '15 minutes'),
 check(deposit_cents+remaining_cents=snapshot_price_cents),
 check(deposit_cents=(round(snapshot_price_cents::numeric*snapshot_percent/100))::integer)
);
create index agenda_payment_holds_live_idx on public.agenda_payment_holds(page_id,starts_at,ends_at)
 where status in ('pending_payment','confirmed','refunding');
alter table public.agenda_payment_holds enable row level security;
revoke all on public.agenda_payment_holds from public,anon,authenticated;

create table public.agenda_payment_attempts(
 id uuid primary key default gen_random_uuid(),
 hold_id uuid not null references public.agenda_payment_holds(id),
 provider text not null default 'mercadopago' check(provider='mercadopago'),
 provider_payment_id text unique,
 provider_request_id uuid not null unique,
 amount_cents integer not null check(amount_cents>0),
 currency text not null default 'BRL' check(currency='BRL'),
 observed_status text not null default 'created'
  check(observed_status in('created','pending','approved','rejected','refunded','cancelled')),
 validated_by_provider boolean not null default false,
 provider_verified_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check(observed_status<>'approved' or
  (validated_by_provider and provider_verified_at is not null and provider_payment_id is not null))
);
create unique index agenda_payment_attempt_hold_live_idx
 on public.agenda_payment_attempts(hold_id)
 where observed_status in ('created','pending','approved');
alter table public.agenda_payment_attempts enable row level security;
revoke all on public.agenda_payment_attempts from public,anon,authenticated;

create table public.agenda_payment_refunds(
 id uuid primary key default gen_random_uuid(),
 payment_attempt_id uuid not null references public.agenda_payment_attempts(id),
 requested_by uuid references auth.users(id),
 amount_cents integer not null check(amount_cents>0),
 reason text not null check(length(reason) between 8 and 250),
 status text not null default 'requested'
  check(status in('requested','processing','confirmed','failed')),
 provider_refund_id text unique,
 provider_verified_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check(status<>'confirmed' or
  (provider_refund_id is not null and provider_verified_at is not null))
);
alter table public.agenda_payment_refunds enable row level security;
revoke all on public.agenda_payment_refunds from public,anon,authenticated;

create function public.agenda_hold_disabled_guard()
returns trigger language plpgsql security definer set search_path='pg_catalog' as $$
begin
 if not exists(select 1 from public.agenda_payment_control c
   where c.singleton and c.charges_enabled and c.oauth_recipient_homologated
     and c.provider_webhook_homologated and c.refunds_homologated
     and c.reconciler_homologated and c.live_finance_approved)
 then raise exception 'AGENDA_PAYMENTS_NOT_HOMOLOGATED' using errcode='42501';end if;
 -- Holds are only valid in an independently verified server-side flow.
 -- Direct client access is never permitted, regardless of payment control.
 if current_user not in ('postgres','service_role')
 then raise exception 'AGENDA_PAYMENT_SERVER_ONLY' using errcode='42501';end if;
 return new;
end $$;
revoke all on function public.agenda_hold_disabled_guard() from public,anon,authenticated;
create trigger agenda_hold_disabled_guard_trigger before insert on public.agenda_payment_holds
 for each row execute function public.agenda_hold_disabled_guard();

-- Owner can prepare business terms, but cannot activate collection.
create function public.agenda_set_deposit_policy(
 p_service_id uuid,p_percent smallint,p_policy_text text
) returns jsonb language plpgsql security definer set search_path='pg_catalog' as $$
declare v_owner uuid:=(select auth.uid());v_service public.agenda_services%rowtype;
 v_row public.agenda_service_deposit_settings%rowtype;
begin
 if v_owner is null or not public.discovery_verified_account() or
    p_percent is null or p_percent not in (0,10,20,25,30,50)
 then raise exception 'AGENDA_POLICY_NOT_ALLOWED' using errcode='42501';end if;
 if length(btrim(coalesce(p_policy_text,''))) not between 30 and 500
 then raise exception 'AGENDA_POLICY_TEXT_INVALID' using errcode='22023';end if;
 select * into v_service from public.agenda_services
 where id=p_service_id and owner_id=v_owner for share;
 if not found or not exists(select 1 from public.agenda_pages p
  where p.id=v_service.page_id and p.owner_id=v_owner)
 then raise exception 'AGENDA_POLICY_NOT_ALLOWED' using errcode='42501';end if;
 insert into public.agenda_service_deposit_settings(
  service_id,page_id,owner_id,percent,policy_text)
 values(v_service.id,v_service.page_id,v_owner,p_percent,btrim(p_policy_text))
 on conflict(service_id) do update set
  percent=excluded.percent,
  policy_text=excluded.policy_text,
  policy_version=public.agenda_service_deposit_settings.policy_version+
    case when public.agenda_service_deposit_settings.percent is distinct from excluded.percent
      or public.agenda_service_deposit_settings.policy_text is distinct from excluded.policy_text then 1 else 0 end,
  updated_at=now()
 returning * into v_row;
 return jsonb_build_object('service_id',v_row.service_id,'percent',v_row.percent,
  'policy_version',v_row.policy_version,
  'charges_enabled',false,'funds_owner','professional');
end $$;
revoke all on function public.agenda_set_deposit_policy(uuid,smallint,text) from public,anon,authenticated;
grant execute on function public.agenda_set_deposit_policy(uuid,smallint,text) to authenticated;

-- Public finance preview deliberately never implies checkout is ready.
create function public.agenda_deposit_quote(p_service_id uuid)
returns jsonb language sql stable security definer set search_path='pg_catalog' as $$
 select jsonb_build_object(
  'service_id',s.id,'price_cents',s.price_cents,
  'percent',coalesce(cfg.percent,0),
  'deposit_cents',round(s.price_cents::numeric*coalesce(cfg.percent,0)/100)::integer,
  'remaining_cents',s.price_cents-round(s.price_cents::numeric*coalesce(cfg.percent,0)/100)::integer,
  'policy_text',coalesce(cfg.policy_text,'O sinal abate do preço total e respeita os direitos de cancelamento e reembolso.'),
  'policy_version',coalesce(cfg.policy_version,0),
  'currency','BRL','receiver','professional',
  'charges_enabled',false,'methods','[]'::jsonb,
  'message','O sinal ainda não está habilitado. Você pode agendar gratuitamente.'
 ) from public.agenda_services s
 join public.agenda_pages p on p.id=s.page_id and p.published
 left join public.agenda_service_deposit_settings cfg on cfg.service_id=s.id
 where s.id=p_service_id and s.active
$$;
revoke all on function public.agenda_deposit_quote(uuid) from public,anon,authenticated;
grant execute on function public.agenda_deposit_quote(uuid) to anon,authenticated;

commit;
