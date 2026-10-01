-- Chama São Gabriel — anonymous-auth RLS hardening v1.5.1
-- Keep anonymous customer reads intentional; require permanent identity for merchant data.
-- Server-authoritative order/quote tables remain inaccessible directly.

-- Server-only tables: no browser grants + RLS with no policies = deny by default.
drop policy if exists "deny authenticated quotes" on public.quotes;
drop policy if exists "deny authenticated quote items" on public.quote_items;
drop policy if exists "deny authenticated action requests" on public.action_requests;
drop policy if exists "deny authenticated delivery secrets" on public.order_delivery_secrets;
drop policy if exists "deny authenticated requote items" on public.order_requote_items;
drop policy if exists "deny authenticated api rate limits" on public.api_rate_limits;

revoke all on table
  public.quotes,
  public.quote_items,
  public.action_requests,
  public.order_delivery_secrets,
  public.order_requote_items,
  public.api_rate_limits
from anon, authenticated;

-- Orders are exposed only through authenticated Edge Functions.
drop policy if exists "read own or assigned orders" on public.orders;
drop policy if exists "read visible order items" on public.order_items;
drop policy if exists "read visible order events" on public.order_events;

revoke select on table
  public.orders,
  public.order_items,
  public.order_events
from authenticated;

-- Merchant-side direct reads must require a permanent identity.
drop policy if exists "read own merchant profile" on public.merchants;
create policy "read own merchant profile"
on public.merchants
for select
to authenticated
using (
  (select coalesce((auth.jwt()->>'is_anonymous')::boolean,false)) is false
  and exists (
    select 1
    from public.merchant_members mm
    where mm.merchant_id=merchants.id
      and mm.user_id=(select auth.uid())
      and mm.active
  )
);

drop policy if exists "read own merchant memberships" on public.merchant_members;
create policy "read own merchant memberships"
on public.merchant_members
for select
to authenticated
using (
  (select coalesce((auth.jwt()->>'is_anonymous')::boolean,false)) is false
  and user_id=(select auth.uid())
);

drop policy if exists "read own merchant catalog" on public.catalog_items;
create policy "read own merchant catalog"
on public.catalog_items
for select
to authenticated
using (
  (select coalesce((auth.jwt()->>'is_anonymous')::boolean,false)) is false
  and exists (
    select 1
    from public.merchant_members mm
    where mm.merchant_id=catalog_items.merchant_id
      and mm.user_id=(select auth.uid())
      and mm.active
  )
);

drop policy if exists "read own merchant applications" on public.merchant_applications;
create policy "read own merchant applications"
on public.merchant_applications
for select
to authenticated
using (
  (select coalesce((auth.jwt()->>'is_anonymous')::boolean,false)) is false
  and applicant_user_id=(select auth.uid())
);

-- Customer-owned profile/wallet/referral reads intentionally remain available
-- to anonymous authenticated customers; each is scoped strictly to auth.uid().
