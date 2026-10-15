-- TAMÃO V1.314.2 — prevent canceling a locally issued statement while a PSP checkout exists.
-- A customer might retain an external Mercado Pago preference after the portal hides its link.
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
drop trigger if exists ads_receivable_external_checkout_guard_v1_314_before_update
 on public.platform_ads_receivables_v1_313;
create trigger ads_receivable_external_checkout_guard_v1_314_before_update
 before update on public.platform_ads_receivables_v1_313 for each row
 execute function public.ads_receivable_external_checkout_guard_v1_314();
revoke all on function public.ads_receivable_external_checkout_guard_v1_314() from public,anon,authenticated;
