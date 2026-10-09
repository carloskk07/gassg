-- TAMÃO V1.142 — Evidence-backed PSP homologation
-- A connected account may run a controlled pilot, but HOMOLOGADO is earned
-- only after a settled sale produces verified provider/device evidence.

create or replace function public.record_order_payment_verification()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','extensions'
as $function$
declare
  v_attempt public.merchant_sale_payment_attempts%rowtype;
  v_level text;
  v_provider text;
  v_evidence_type text;
  v_transaction_id text;
  v_hash text;
  v_provider_evidence boolean:=false;
  v_verified_at timestamptz:=clock_timestamp();
begin
  if new.status<>'SETTLED'
     or new.payment_confirmed_at is null
     or old.payment_confirmed_at is not null then
    return new;
  end if;

  select *
  into v_attempt
  from public.merchant_sale_payment_attempts
  where order_id=new.id
    and merchant_id=new.merchant_id
    and amount_cents=new.total_cents
    and currency='BRL'
    and status='approved'
  order by approved_at asc nulls last,created_at asc,id
  limit 1;

  if found then
    if exists(
      select 1
      from public.merchant_sale_payment_verifications v
      where v.order_id=new.id
        and v.payment_attempt_id=v_attempt.id
        and v.status='verified'
    ) then
      return new;
    end if;
    v_level:=case when v_attempt.verification_level='device' then 'device' else 'provider' end;
    v_provider:=v_attempt.provider;
    v_evidence_type:=case when v_level='device' then 'terminal' else 'provider_api' end;
    v_transaction_id:=v_attempt.provider_payment_id;
    v_provider_evidence:=true;
  else
    v_level:='merchant';
    v_provider:='manual';
    v_evidence_type:='merchant_confirmation';
    v_transaction_id:=null;
  end if;

  v_hash:=encode(
    extensions.digest(
      convert_to(
        concat_ws('|',
          'tamao-payment-verification-v1',
          new.id::text,
          coalesce(new.merchant_id::text,''),
          v_provider,
          v_level,
          new.total_cents::text,
          new.payment_confirmed_at::text,
          coalesce(v_transaction_id,'')
        ),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  insert into public.merchant_sale_payment_verifications(
    order_id,payment_attempt_id,merchant_id,provider,
    verification_level,evidence_type,provider_transaction_id,
    amount_cents,currency,status,evidence_sha256,funds_owner,
    occurred_at,verified_at,metadata
  )
  values(
    new.id,
    case when v_provider_evidence then v_attempt.id else null end,
    new.merchant_id,
    v_provider,
    v_level,
    v_evidence_type,
    v_transaction_id,
    new.total_cents,
    'BRL',
    'verified',
    v_hash,
    'merchant',
    new.payment_confirmed_at,
    v_verified_at,
    jsonb_build_object(
      'orderPaymentConfirmationMethod',new.payment_confirmation_method,
      'source','order_settlement'
    )
  )
  on conflict do nothing;

  if v_provider_evidence then
    update public.merchant_payment_provider_accounts
    set capabilities=
          coalesce(capabilities,'{}'::jsonb)
          ||jsonb_build_object(
            'e2eValidated',true,
            'e2eValidatedAt',v_verified_at,
            'e2eEvidenceOrderId',new.id::text,
            'e2eEvidenceSha256',v_hash,
            'e2eVerificationLevel',v_level
          ),
        updated_at=v_verified_at
    where merchant_id=new.merchant_id
      and provider=v_provider
      and status='active';
  end if;

  return new;
end;
$function$;

revoke all on function public.record_order_payment_verification()
  from public,anon,authenticated;
grant execute on function public.record_order_payment_verification()
  to service_role;

-- Preserve proof already earned before V1.142, if any.
with latest as (
  select distinct on (merchant_id,provider)
    merchant_id,
    provider,
    order_id,
    evidence_sha256,
    verification_level,
    verified_at
  from public.merchant_sale_payment_verifications
  where status='verified'
    and verification_level in ('provider','device')
    and provider<>'manual'
    and funds_owner='merchant'
  order by merchant_id,provider,verified_at desc nulls last,created_at desc,id desc
)
update public.merchant_payment_provider_accounts a
set capabilities=
      coalesce(a.capabilities,'{}'::jsonb)
      ||jsonb_build_object(
        'e2eValidated',true,
        'e2eValidatedAt',latest.verified_at,
        'e2eEvidenceOrderId',latest.order_id::text,
        'e2eEvidenceSha256',latest.evidence_sha256,
        'e2eVerificationLevel',latest.verification_level
      ),
    updated_at=greatest(a.updated_at,coalesce(latest.verified_at,a.updated_at))
from latest
where a.merchant_id=latest.merchant_id
  and a.provider=latest.provider
  and a.status='active';

comment on function public.record_order_payment_verification()
  is 'V1.142 records immutable sale evidence and promotes active PSP accounts to evidence-backed e2eValidated only after provider/device verified settlement.';
