create or replace function public.merchant_billing_provider_charge_commit(
  p_charge_id uuid,
  p_provider_charge_id text,
  p_provider_transaction_id text,
  p_br_code text,
  p_qr_code_data_uri text,
  p_payment_link_url text,
  p_expires_at timestamptz,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
declare
  v_charge public.merchant_billing_provider_charges%rowtype;
  v_status text:=lower(trim(coalesce(p_status,'')));
  v_provider_charge_id text:=nullif(trim(coalesce(p_provider_charge_id,'')),'');
  v_provider_transaction_id text:=nullif(trim(coalesce(p_provider_transaction_id,'')),'');
  v_br_code text:=nullif(trim(coalesce(p_br_code,'')),'');
  v_qr text:=nullif(trim(coalesce(p_qr_code_data_uri,'')),'');
  v_link text:=nullif(trim(coalesce(p_payment_link_url,'')),'');
  v_expires_at timestamptz:=coalesce(
    p_expires_at,
    clock_timestamp()+interval '24 hours'
  );
begin
  if p_charge_id is null then
    raise exception 'PIX_CHARGE_ID_REQUIRED' using errcode='22023';
  end if;

  if v_status not in ('active','completed') then
    raise exception 'INVALID_PROVIDER_CHARGE_STATUS' using errcode='22023';
  end if;

  if v_provider_charge_id is null
     or char_length(v_provider_charge_id)>240
     or v_provider_charge_id~'[[:cntrl:]]' then
    raise exception 'INVALID_PROVIDER_CHARGE_ID' using errcode='22023';
  end if;

  if v_br_code is null
     or char_length(v_br_code)<20
     or char_length(v_br_code)>8192 then
    raise exception 'INVALID_PROVIDER_BR_CODE' using errcode='22023';
  end if;

  if v_qr is not null
     and (
       char_length(v_qr)>600000
       or v_qr not like 'data:image/png;base64,%'
     ) then
    raise exception 'INVALID_PROVIDER_QR_IMAGE' using errcode='22023';
  end if;

  if v_link is not null
     and (
       char_length(v_link)>2048
       or v_link!~'^https://'
     ) then
    raise exception 'INVALID_PROVIDER_PAYMENT_LINK' using errcode='22023';
  end if;

  select *
  into v_charge
  from public.merchant_billing_provider_charges
  where id=p_charge_id
  for update;

  if not found then
    raise exception 'PIX_CHARGE_NOT_FOUND' using errcode='P0002';
  end if;

  if v_charge.provider not in ('woovi','mercadopago') then
    raise exception 'PIX_CHARGE_PROVIDER_MISMATCH' using errcode='40001';
  end if;

  if v_charge.status in ('completed','expired','cancelled') then
    if v_charge.status='completed' then
      if (v_charge.provider_charge_id is not null
          and v_charge.provider_charge_id is distinct from v_provider_charge_id)
         or (v_charge.br_code is not null
          and v_charge.br_code is distinct from v_br_code) then
        raise exception 'PIX_CHARGE_COMMIT_CONFLICT' using errcode='23505';
      end if;

      update public.merchant_billing_provider_charges
      set provider_charge_id=coalesce(provider_charge_id,v_provider_charge_id),
          provider_transaction_id=coalesce(provider_transaction_id,v_provider_transaction_id),
          br_code=coalesce(br_code,v_br_code),
          qr_code_data_uri=coalesce(qr_code_data_uri,v_qr),
          payment_link_url=coalesce(payment_link_url,v_link),
          expires_at=coalesce(expires_at,v_expires_at),
          last_error_code=null,
          last_error_at=null,
          updated_at=clock_timestamp()
      where id=v_charge.id
      returning * into v_charge;
    elsif v_charge.status in ('cancelled','expired') then
      if v_charge.provider_charge_id is not null
         and v_charge.provider_charge_id is distinct from v_provider_charge_id then
        raise exception 'PIX_CHARGE_COMMIT_CONFLICT' using errcode='23505';
      end if;

      -- A provider can finish creating an Order after local cancellation/expiry.
      -- Persist only its identity/evidence, never revive the local charge or
      -- return a usable QR. Cancelled rows stay in the provider-cancel queue.
      update public.merchant_billing_provider_charges
      set provider_charge_id=coalesce(provider_charge_id,v_provider_charge_id),
          provider_transaction_id=coalesce(provider_transaction_id,v_provider_transaction_id),
          expires_at=coalesce(expires_at,v_expires_at),
          last_error_code=case
            when status='cancelled'
              then coalesce(last_error_code,'PROVIDER_CANCEL_REQUIRED')
            else last_error_code
          end,
          last_error_at=case
            when status='cancelled'
              then coalesce(last_error_at,clock_timestamp())
            else last_error_at
          end,
          updated_at=clock_timestamp()
      where id=v_charge.id
      returning * into v_charge;
    end if;
  else
    update public.merchant_billing_provider_charges
    set status=v_status,
        provider_charge_id=v_provider_charge_id,
        provider_transaction_id=v_provider_transaction_id,
        br_code=v_br_code,
        qr_code_data_uri=v_qr,
        payment_link_url=v_link,
        expires_at=v_expires_at,
        last_error_code=null,
        last_error_at=null,
        updated_at=clock_timestamp()
    where id=v_charge.id
    returning * into v_charge;
  end if;

  return jsonb_build_object(
    'ok',true,
    'chargeId',v_charge.id,
    'paymentRequestId',v_charge.payment_request_id,
    'provider',v_charge.provider,
    'correlationId',v_charge.correlation_id,
    'status',v_charge.status,
    'amountCents',v_charge.amount_cents,
    'brCode',v_charge.br_code,
    'qrCodeDataUri',v_charge.qr_code_data_uri,
    'paymentLinkUrl',v_charge.payment_link_url,
    'expiresAt',v_charge.expires_at
  );
end;
$function$;

revoke all on function public.merchant_billing_provider_charge_commit(
  uuid,text,text,text,text,text,timestamptz,text
) from public,anon,authenticated;
grant execute on function public.merchant_billing_provider_charge_commit(
  uuid,text,text,text,text,text,timestamptz,text
) to service_role;
