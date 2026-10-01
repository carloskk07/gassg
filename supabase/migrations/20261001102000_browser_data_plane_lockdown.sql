-- Chama São Gabriel — browser data-plane lockdown v1.5.7
-- After the frontend uses customer-summary and merchant Edge projections,
-- no application table needs direct browser SELECT access.

drop policy if exists "read own merchant profile" on public.merchants;
drop policy if exists "read own merchant memberships" on public.merchant_members;
drop policy if exists "read own merchant catalog" on public.catalog_items;
drop policy if exists "read own merchant applications" on public.merchant_applications;
drop policy if exists "read own profile" on public.profiles;
drop policy if exists "read own referral relationships" on public.referrals;
drop policy if exists "read own wallet ledger" on public.wallet_entries;

revoke all on table
  public.merchants,
  public.merchant_members,
  public.catalog_items,
  public.merchant_applications,
  public.profiles,
  public.referrals,
  public.wallet_entries
from anon, authenticated;

-- Service role remains the only runtime data-plane authority.
grant all on table
  public.merchants,
  public.merchant_members,
  public.catalog_items,
  public.merchant_applications,
  public.profiles,
  public.referrals,
  public.wallet_entries
to service_role;
