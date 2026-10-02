-- Chama São Gabriel — closed-world wallet ledger v1.20.1
-- Disable ledger entry types that do not yet have an explicit audited authority.
-- A payout/adjustment feature must re-open them through a dedicated migration and RPC.

alter table public.wallet_entries
  drop constraint if exists wallet_entries_entry_type_check;

alter table public.wallet_entries
  add constraint wallet_entries_entry_type_check
  check (
    entry_type in (
      'cashback_seed',
      'cashback_reserve',
      'cashback_release',
      'cashback_earn',
      'cashback_reversal',
      'referral_pending',
      'referral_pending_release',
      'referral_available',
      'referral_reversal'
    )
  );

alter table public.wallet_entries
  drop constraint if exists wallet_entries_check;

alter table public.wallet_entries
  add constraint wallet_entries_bucket_entry_type_check
  check (
    (
      entry_type like 'cashback_%'
      and bucket='cashback'
    )
    or
    (
      entry_type in ('referral_pending','referral_pending_release')
      and bucket='commission_pending'
    )
    or
    (
      entry_type in ('referral_available','referral_reversal')
      and bucket='commission_available'
    )
  );

alter table public.wallet_entries
  drop constraint if exists wallet_entries_check1;

alter table public.wallet_entries
  add constraint wallet_entries_sign_check
  check (
    (
      entry_type in (
        'cashback_seed',
        'cashback_release',
        'cashback_earn',
        'referral_pending',
        'referral_available'
      )
      and amount_cents>0
    )
    or
    (
      entry_type in (
        'cashback_reserve',
        'cashback_reversal',
        'referral_pending_release',
        'referral_reversal'
      )
      and amount_cents<0
    )
  );

alter table public.wallet_entries
  drop constraint if exists wallet_entries_order_provenance_check;

alter table public.wallet_entries
  add constraint wallet_entries_order_provenance_check
  check (
    entry_type='cashback_seed'
    or order_id is not null
  );

alter table public.wallet_entries
  drop constraint if exists wallet_entries_metadata_object_check;

alter table public.wallet_entries
  add constraint wallet_entries_metadata_object_check
  check (
    metadata is null
    or jsonb_typeof(metadata)='object'
  );
