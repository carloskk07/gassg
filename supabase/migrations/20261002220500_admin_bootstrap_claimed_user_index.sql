-- Cover the admin bootstrap reservation FK reported by the Supabase advisor.
create index if not exists platform_admin_bootstrap_reservations_claimed_user_idx
  on public.platform_admin_bootstrap_reservations(claimed_user_id)
  where claimed_user_id is not null;
