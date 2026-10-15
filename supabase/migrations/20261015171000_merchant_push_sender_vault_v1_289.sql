-- TAMÃO V1.289 — only the service_role sender can retrieve VAPID private
-- scalar and only when an administrator explicitly enables delivery.
-- It is never returned by the public registration API.
create or replace function public.merchant_push_sender_credentials()
returns jsonb language sql stable security definer set search_path=pg_catalog
as $fn$
  select coalesce((
    select pg_catalog.jsonb_build_object(
      'enabled',true,
      'publicKey',k.public_key,
      'privateKey',v.decrypted_secret,
      'subject',k.subject
    )
    from public.merchant_push_keyring k
    join vault.decrypted_secrets v
      on v.name='tamao_merchant_vapid_private_v1_289'
    where k.id=true and k.sender_enabled
      and v.decrypted_secret ~ '^[A-Za-z0-9_-]{43}$'
  ), '{"enabled":false}'::jsonb)
$fn$;
revoke all on function public.merchant_push_sender_credentials()
  from public,anon,authenticated;
grant execute on function public.merchant_push_sender_credentials() to service_role;
