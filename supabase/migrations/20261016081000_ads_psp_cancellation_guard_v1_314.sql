-- TAMÃO V1.314.1 — prevent internal cancellation from silently leaving a live external checkout.
-- Existing V1.313 logic may cancel only when no paid/active PSP dependency exists.
create or replace function public.ads_receivable_external_checkout_guard_v1_314()
returns trigger language plpgsql set search_path to 'pg_catalog' as $guard$
begin
 if old.status='issued' and new.status='canceled' and exists(
  select 1 from public.platform_ads_psp_checkouts_v1_314 p
  where p.merchant_id=old.merchant_id
    and p.status in ('reserved','checkout_ready','payment_approved')
 ) then
   raise exception 'ADS_RECEIVABLE_EXTERNAL_CHECKOUT_REQUIRES_PROVIDER_REVIEW'
    using errcode='40001';
 end if;
 return new;
end;
$guard$;
create trigger ads_receivable_external_checkout_guard_v1_314_before_update
 before update on public.platform_ads_receivables_v1_313
 for each row execute function public.ads_receivable_external_checkout_guard_v1_314();
-- Grant no new Data API access; this is a trigger-only security function.
revoke all on function public.ads_receivable_external_checkout_guard_v1_314()
  from public,anon,authenticated;
