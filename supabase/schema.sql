-- Chama São Gabriel — backend schema draft v1.2
-- Prepared for a dedicated Supabase project. Do not apply to Reward Pulse.
-- Monetary values are stored as integer cents; write operations are intended to go through server-side Edge Functions.

create extension if not exists pgcrypto;

create table if not exists public.merchants (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120),
  cnpj text not null unique check (cnpj ~ '^[0-9A-Z]{12}[0-9]{2}$'),
  status text not null default 'pending' check (status in ('pending','active','suspended','rejected')),
  online boolean not null default false,
  trust_score smallint not null default 80 check (trust_score between 0 and 100),
  service_radius_km numeric(6,2) check (service_radius_km is null or service_radius_km between 0 and 100),
  address_text text,
  latitude numeric(9,6),
  longitude numeric(9,6),
  price_confirmed_at timestamptz,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.merchant_members (
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  member_role text not null default 'operator' check (member_role in ('owner','manager','operator','driver')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (merchant_id,user_id)
);

create table if not exists public.catalog_items (
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  product_code text not null check (product_code in ('P13','WATER20','CHARCOAL4','WOOD','ICE5')),
  product_name text not null,
  price_cents integer not null check (price_cents > 0),
  available_stock integer not null default 0 check (available_stock >= 0),
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (merchant_id,product_code)
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  public_code text not null unique check (char_length(public_code) between 6 and 32),
  customer_id uuid not null references auth.users(id) on delete restrict,
  merchant_id uuid references public.merchants(id) on delete restrict,
  proposed_merchant_id uuid references public.merchants(id) on delete restrict,
  status text not null check (status in (
    'OFFERED_TO_MERCHANT',
    'MERCHANT_ACCEPTED',
    'PREPARING',
    'AT_RISK',
    'REASSIGNING',
    'REQUOTE_REQUIRED',
    'OUT_FOR_DELIVERY',
    'ARRIVING',
    'DELIVERED',
    'SETTLED',
    'CANCELLED'
  )),
  address_text text not null check (char_length(address_text) between 5 and 240),
  payment_method text not null check (payment_method in ('pix','card','cash')),
  gross_total_cents integer not null check (gross_total_cents >= 0),
  cashback_reserved_cents integer not null default 0 check (cashback_reserved_cents >= 0),
  total_cents integer not null check (total_cents >= 0),
  proposed_gross_total_cents integer check (proposed_gross_total_cents is null or proposed_gross_total_cents >= 0),
  proposed_total_cents integer check (proposed_total_cents is null or proposed_total_cents >= 0),
  pin_hash text not null,
  pin_failures smallint not null default 0 check (pin_failures between 0 and 5),
  attempted_merchant_ids uuid[] not null default '{}',
  risk_reason text,
  offer_expires_at timestamptz,
  accepted_at timestamptz,
  dispatch_due_at timestamptz,
  dispatched_at timestamptz,
  arriving_at timestamptz,
  promised_by timestamptz,
  delivered_at timestamptz,
  settled_at timestamptz,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.order_items (
  order_id uuid not null references public.orders(id) on delete cascade,
  product_code text not null check (product_code in ('P13','WATER20','CHARCOAL4','WOOD','ICE5')),
  product_name text not null,
  quantity integer not null check (quantity between 1 and 99),
  unit_price_cents integer not null check (unit_price_cents > 0),
  line_total_cents integer not null check (line_total_cents = quantity * unit_price_cents),
  primary key (order_id,product_code)
);

create table if not exists public.order_events (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_type text not null check (actor_type in ('customer','merchant','system','admin')),
  event_type text not null,
  title text not null,
  detail text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.wallet_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  order_id uuid references public.orders(id) on delete set null,
  entry_type text not null check (entry_type in (
    'cashback_seed',
    'cashback_reserve',
    'cashback_release',
    'cashback_earn',
    'referral_pending',
    'referral_release',
    'referral_reversal',
    'manual_adjustment'
  )),
  amount_cents integer not null check (amount_cents <> 0),
  idempotency_key text not null unique,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.referrals (
  referred_user_id uuid primary key references auth.users(id) on delete cascade,
  referrer_user_id uuid not null references auth.users(id) on delete cascade,
  referral_code text not null,
  qualified_order_id uuid references public.orders(id) on delete set null,
  created_at timestamptz not null default now(),
  check (referred_user_id <> referrer_user_id)
);

create table if not exists public.merchant_applications (
  id uuid primary key default gen_random_uuid(),
  applicant_user_id uuid not null references auth.users(id) on delete cascade,
  cnpj text not null check (cnpj ~ '^[0-9A-Z]{12}[0-9]{2}$'),
  company_name text not null check (char_length(company_name) between 2 and 120),
  responsible_name text not null check (char_length(responsible_name) between 2 and 120),
  phone text not null check (char_length(phone) between 10 and 20),
  address_text text not null check (char_length(address_text) between 5 and 240),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (applicant_user_id,cnpj)
);

create index if not exists merchants_status_online_idx on public.merchants(status,online);
create index if not exists catalog_active_idx on public.catalog_items(merchant_id,active);
create index if not exists orders_customer_created_idx on public.orders(customer_id,created_at desc);
create index if not exists orders_merchant_status_idx on public.orders(merchant_id,status,created_at desc);
create index if not exists order_events_order_created_idx on public.order_events(order_id,created_at);
create index if not exists wallet_entries_user_created_idx on public.wallet_entries(user_id,created_at desc);
create index if not exists referrals_referrer_idx on public.referrals(referrer_user_id,created_at desc);

alter table public.merchants enable row level security;
alter table public.merchant_members enable row level security;
alter table public.catalog_items enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_events enable row level security;
alter table public.wallet_entries enable row level security;
alter table public.referrals enable row level security;
alter table public.merchant_applications enable row level security;

-- Explicit grants are required for new Supabase projects when automatic Data API exposure is disabled.
revoke all on table
  public.merchants,
  public.merchant_members,
  public.catalog_items,
  public.orders,
  public.order_items,
  public.order_events,
  public.wallet_entries,
  public.referrals,
  public.merchant_applications
from anon, authenticated;

grant select on table public.merchants, public.catalog_items to authenticated;
grant select on table
  public.merchant_members,
  public.orders,
  public.order_items,
  public.order_events,
  public.wallet_entries,
  public.referrals,
  public.merchant_applications
to authenticated;

grant all on table
  public.merchants,
  public.merchant_members,
  public.catalog_items,
  public.orders,
  public.order_items,
  public.order_events,
  public.wallet_entries,
  public.referrals,
  public.merchant_applications
to service_role;

grant usage, select on all sequences in schema public to service_role;

drop policy if exists "active merchants or own merchant" on public.merchants;
create policy "active merchants or own merchant"
on public.merchants
for select
to authenticated
using (
  status = 'active'
  or exists (
    select 1
    from public.merchant_members mm
    where mm.merchant_id = merchants.id
      and mm.user_id = (select auth.uid())
      and mm.active
  )
);

drop policy if exists "read own merchant memberships" on public.merchant_members;
create policy "read own merchant memberships"
on public.merchant_members
for select
to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "read available catalog" on public.catalog_items;
create policy "read available catalog"
on public.catalog_items
for select
to authenticated
using (
  exists (
    select 1
    from public.merchants m
    where m.id = catalog_items.merchant_id
      and (
        (m.status = 'active' and m.online)
        or exists (
          select 1 from public.merchant_members mm
          where mm.merchant_id = m.id
            and mm.user_id = (select auth.uid())
            and mm.active
        )
      )
  )
);

drop policy if exists "read own or assigned orders" on public.orders;
create policy "read own or assigned orders"
on public.orders
for select
to authenticated
using (
  customer_id = (select auth.uid())
  or exists (
    select 1
    from public.merchant_members mm
    where mm.merchant_id = orders.merchant_id
      and mm.user_id = (select auth.uid())
      and mm.active
  )
);

drop policy if exists "read visible order items" on public.order_items;
create policy "read visible order items"
on public.order_items
for select
to authenticated
using (
  exists (
    select 1
    from public.orders o
    where o.id = order_items.order_id
      and (
        o.customer_id = (select auth.uid())
        or exists (
          select 1
          from public.merchant_members mm
          where mm.merchant_id = o.merchant_id
            and mm.user_id = (select auth.uid())
            and mm.active
        )
      )
  )
);

drop policy if exists "read visible order events" on public.order_events;
create policy "read visible order events"
on public.order_events
for select
to authenticated
using (
  exists (
    select 1
    from public.orders o
    where o.id = order_events.order_id
      and (
        o.customer_id = (select auth.uid())
        or exists (
          select 1
          from public.merchant_members mm
          where mm.merchant_id = o.merchant_id
            and mm.user_id = (select auth.uid())
            and mm.active
        )
      )
  )
);

drop policy if exists "read own wallet ledger" on public.wallet_entries;
create policy "read own wallet ledger"
on public.wallet_entries
for select
to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "read own referral relationships" on public.referrals;
create policy "read own referral relationships"
on public.referrals
for select
to authenticated
using (
  referred_user_id = (select auth.uid())
  or referrer_user_id = (select auth.uid())
);

drop policy if exists "read own merchant applications" on public.merchant_applications;
create policy "read own merchant applications"
on public.merchant_applications
for select
to authenticated
using (applicant_user_id = (select auth.uid()));

-- Postgres Changes is sufficient for the first São Gabriel pilot.
-- Broadcast can replace it later if scale or stricter Realtime authorization warrants it.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'orders'
    ) then
      execute 'alter publication supabase_realtime add table public.orders';
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'order_events'
    ) then
      execute 'alter publication supabase_realtime add table public.order_events';
    end if;
  end if;
end
$$;
