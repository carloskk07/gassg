-- TAMÃO: atomic audit of MP net proceeds registered by a verified superadmin.
-- This is a thin wrapper around the EXISTING coupon ledger RPC: no second
-- funding engine, new financial table, payout, coupon, or sales enablement.
-- A failed audit insert rolls back the underlying net registration in the
-- same PostgreSQL transaction. An idempotent retry is separately audited.
create or replace function public.clube_coupon_paid_net_proceeds_verify_audited(
 p_invoice_id uuid,
 p_provider_order_id text,
 p_net_cents integer,
 p_reference text,
 p_actor_user_id uuid
) returns jsonb
language plpgsql
security definer
set search_path=pg_catalog
as $$
declare
 v_result jsonb;
 v_audit_id uuid;
begin
 if p_actor_user_id is null
   or not exists (
     select 1 from public.platform_admins a
     where a.user_id=p_actor_user_id and a.active=true
       and a.admin_role='superadmin'
   ) then
   raise exception 'COUPON_NET_AUDIT_SUPERADMIN_REQUIRED' using errcode='42501';
 end if;

 -- Existing RPC locks the invoice, validates that gross Pix is paid and
 -- that NET proceeds cover all coupon obligations, and handles conflicts.
 v_result:=public.clube_coupon_paid_net_proceeds_verify(
   p_invoice_id,p_provider_order_id,p_net_cents,p_reference
 );
 if v_result->>'ok' is distinct from 'true'
   or v_result->>'invoiceId' is distinct from p_invoice_id::text then
   raise exception 'COUPON_NET_AUDIT_REGISTRATION_UNCONFIRMED'
     using errcode='P0001';
 end if;

 insert into public.platform_admin_audit(
    actor_user_id,action,target_type,target_id,metadata
 ) values(
    p_actor_user_id,
    'coupon_net_receipt_registered',
    'clube_coupon_paid_invoice',
    p_invoice_id::text,
    pg_catalog.jsonb_build_object(
      'source','mercadopago_release_report',
      'providerOrderId',p_provider_order_id,
      'netCents',p_net_cents,
      'evidenceReference',pg_catalog.btrim(p_reference),
      'replayed',v_result->'replayed'
    )
 ) returning id into v_audit_id;

 return v_result || pg_catalog.jsonb_build_object(
   'auditId',v_audit_id,
   'auditRecorded',true
 );
end
$$;

revoke all on function public.clube_coupon_paid_net_proceeds_verify_audited(
 uuid,text,integer,text,uuid
) from public,anon,authenticated;
grant execute on function public.clube_coupon_paid_net_proceeds_verify_audited(
 uuid,text,integer,text,uuid
) to service_role;
