-- TAMÃO V1.140 — Payment route metadata invariants
-- Metadata is descriptive only. It must never upgrade a route into automated
-- verification, change funds ownership, or blur a merchant-declared fallback
-- with a provider-authoritative connection.

alter table public.merchant_payment_routes
  add constraint merchant_payment_routes_metadata_shape_check
  check (
    jsonb_typeof(metadata)='object'
    and octet_length(metadata::text)<=8192
    and (
      not (metadata ? 'autoManaged')
      or jsonb_typeof(metadata->'autoManaged')='boolean'
    )
    and (
      not (metadata ? 'merchantDeclaredProvider')
      or jsonb_typeof(metadata->'merchantDeclaredProvider')='boolean'
    )
    and (
      not (metadata ? 'manualProviderFallback')
      or jsonb_typeof(metadata->'manualProviderFallback')='boolean'
    )
    and (
      not (metadata ? 'automaticVerification')
      or jsonb_typeof(metadata->'automaticVerification')='boolean'
    )
    and (
      not (metadata ? 'fundsOwner')
      or (
        jsonb_typeof(metadata->'fundsOwner')='string'
        and metadata->>'fundsOwner'='merchant'
      )
    )
  );

alter table public.merchant_payment_routes
  add constraint merchant_payment_routes_declared_provider_metadata_check
  check (
    coalesce(metadata->>'merchantDeclaredProvider','false')<>'true'
    or (
      provider<>'manual'
      and verification_mode='merchant_confirmed'
      and connection_id is null
      and channel='external'
      and coalesce(metadata->>'manualProviderFallback','false')='true'
      and coalesce(metadata->>'automaticVerification','false')='false'
      and metadata->>'fundsOwner'='merchant'
    )
  );

alter table public.merchant_payment_routes
  add constraint merchant_payment_routes_auto_managed_metadata_check
  check (
    coalesce(metadata->>'autoManaged','false')<>'true'
    or (
      provider<>'manual'
      and verification_mode in ('provider_api','device')
      and connection_id is not null
    )
  );

comment on constraint merchant_payment_routes_metadata_shape_check
  on public.merchant_payment_routes
  is 'V1.140 bounds descriptive route metadata and prevents funds-owner ambiguity.';

comment on constraint merchant_payment_routes_declared_provider_metadata_check
  on public.merchant_payment_routes
  is 'V1.140 merchant-declared PSP fallback is external, merchant-confirmed, non-custodial and never automatically verified.';

comment on constraint merchant_payment_routes_auto_managed_metadata_check
  on public.merchant_payment_routes
  is 'V1.140 autoManaged metadata is valid only for a real provider/device connection.';
