import "jsr:@supabase/functions-js@2.117.2/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.117.2";
import { sha256Hex as billingEvidenceHash } from "../_shared/domain.js";
import {mobilityFeeEvidenceHash} from "../_shared/mobility-fee-evidence.js";
import {
  decryptPaymentSecret,
  paymentEncryptionConfigured,
  sha256Hex as paymentEvidenceHash
} from "../_shared/payment-secrets.js";
import {
  mercadoPagoConfigured,
  mercadoPagoFetch,
  readMercadoPagoJson,
  moneyToCents,
  verifyMercadoPagoWebhook
} from "../_shared/mercadopago.js";

const SUPABASE_URL=Deno.env.get("SUPABASE_URL")??"";
const secretKeys=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")??"{}");
const SECRET_KEY=secretKeys.default??Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")??"";
const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BODY_BYTES=65536;
const WEBHOOK_PROBE_RE=/^TAMAO-WEBHOOK-PROBE-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

import {json,handleMobilityFeeOrder,safeOccurredAt,orderPayments,primaryPayment,billingPixPayment,refundedCents,merchantProviderStatus,fetchProviderOrder,ingestPlatformPayment,ingestPlatformRefunds,handleMerchantSaleOrder,handlePlatformBillingOrder,handlePaidCouponOrder,handleWebhookProbe,handleFinancialLabLiveOrder} from "./handlers.ts";

Deno.serve(async(req:Request)=>{
  if(req.method!=="POST")return json({error:"METHOD_NOT_ALLOWED"},405);

  const webhookSecret=String(Deno.env.get("MERCADOPAGO_WEBHOOK_SECRET")??"").trim();
  if(webhookSecret.length<16){
    return json({error:"MERCADOPAGO_WEBHOOK_NOT_CONFIGURED"},503);
  }

  try{
    const declared=Number(req.headers.get("content-length")??0);
    if(Number.isFinite(declared)&&declared>MAX_BODY_BYTES){
      return json({error:"PAYLOAD_TOO_LARGE"},413);
    }
    const raw=await req.text();
    if(new TextEncoder().encode(raw).byteLength>MAX_BODY_BYTES){
      return json({error:"PAYLOAD_TOO_LARGE"},413);
    }
    let body:any={};
    try{body=raw?JSON.parse(raw):{}}
    catch{return json({error:"INVALID_JSON"},400)}

    const url=new URL(req.url);
    const dataId=String(
      url.searchParams.get("data.id")
      ??body?.data?.id
      ??""
    ).trim();
    if(dataId.length<6||dataId.length>240||/[\u0000-\u001f\u007f]/.test(dataId)){
      return json({error:"INVALID_PROVIDER_ORDER_ID"},400);
    }

    const signed=await verifyMercadoPagoWebhook(req,webhookSecret,dataId);
    if(!signed){
      // Log only non-sensitive signature SHAPE for server-issued test probes.
      // Never log the secret, x-signature, x-request-id, HMAC, buyer, or body.
      // Real payment requests retain the same fail-closed HTTP 401 behavior.
      if(WEBHOOK_PROBE_RE.test(dataId)){
        const header=String(req.headers.get("x-signature")??"");
        const signatureParts=header.split(",").map(x=>x.trim());
        const ts=signatureParts.find(x=>x.startsWith("ts="))?.slice(3)??"";
        const v1=signatureParts.find(x=>x.startsWith("v1="))?.slice(3)??"";
        console.warn("MERCADOPAGO_PROBE_HMAC_REJECTED",JSON.stringify({
          signaturePresent:Boolean(header),
          requestIdPresent:Boolean(req.headers.get("x-request-id")),
          queryDataIdPresent:url.searchParams.has("data.id"),
          signatureShapeValid:/^\d{9,16}$/.test(ts)
            &&/^[0-9a-f]{64}$/i.test(v1),
          reason:!header?"missing_signature"
            :!/^\d{9,16}$/.test(ts)||!/^[0-9a-f]{64}$/i.test(v1)
              ?"invalid_signature_shape":"hmac_mismatch"
        }));
      }
      return json({error:"INVALID_MERCADOPAGO_SIGNATURE"},401);
    }

    const topic=String(
      url.searchParams.get("type")
      ??body?.type
      ??""
    ).trim().toLowerCase();
    if(!["order","orders"].includes(topic)){
      return json({ok:true,ignored:true,reason:"UNSUPPORTED_TOPIC"},202);
    }

    const admin=createClient(SUPABASE_URL,SECRET_KEY,{
      auth:{persistSession:false,autoRefreshToken:false}
    });

    // Provider-signed simulator proof. The reserved resource ID namespace can
    // never be treated as a financial Order. Signature verification already
    // succeeded above, and the RPC can only consume a short-lived admin probe.
    if(WEBHOOK_PROBE_RE.test(dataId)){
      return await handleWebhookProbe(admin,req,dataId,topic,body);
    }

    // A REAL, operator-authorized laboratory order has its own audit binding.
    // Do not route these payments to merchant billing or funded benefits.
    const {data:labProof,error:labError}=await admin.from("platform_admin_audit")
      .select("actor_user_id,target_id,metadata")
      .eq("action","finance_lab_live_pix_created")
      .eq("target_id",dataId).limit(1).maybeSingle();
    if(labError)throw labError;
    if(labProof){
      return await handleFinancialLabLiveOrder(admin,dataId,labProof);
    }

    // Route by an exact local provider-order binding first. This allows one
    // Mercado Pago production webhook URL for platform billing and every
    // OAuth-connected merchant without ever guessing which token owns an order.
    const {data:merchantAttempt,error:attemptError}=await admin
      .from("merchant_sale_payment_attempts")
      .select("id,order_id,merchant_id,external_reference,amount_cents,currency,status,provider_order_id")
      .eq("provider","mercadopago")
      .eq("provider_order_id",dataId)
      .maybeSingle();
    if(attemptError)throw attemptError;

    if(merchantAttempt){
      return await handleMerchantSaleOrder(
        admin,
        merchantAttempt,
        dataId,
        body,
        String(Deno.env.get("MERCHANT_PAYMENT_TOKEN_ENCRYPTION_KEY")??"").trim()
      );
    }

    // Strict provider-order binding prevents mixing coupon charges with
    // existing merchant-billing and merchant-OAuth payments.
    const {data:couponInvoice,error:couponLookupError}=await admin
      .from("clube_coupon_paid_invoices")
      .select("id,provider_order_id,sale_price_cents,status")
      .eq("provider","mercadopago")
      .eq("provider_order_id",dataId)
      .maybeSingle();
    // No coupon tables on older deployments: preserve all existing routes.
    if(couponLookupError&&couponLookupError.code!=="42P01")throw couponLookupError;
    if(couponInvoice){
      return await handlePaidCouponOrder(admin,dataId,couponInvoice,
        String(Deno.env.get("MERCADOPAGO_ACCESS_TOKEN")??"").trim());
    }

    // Only this exact bound provider Order belongs to motorist platform fees.
    // Do not let existing merchant-billing fallback guess the receiver.
    const {data:mobilityInvoice,error:mobilityLookupError}=await admin
      .from("mobility_fee_pix_invoices_v1_837")
      .select("id,external_reference,amount_cents,status,provider_order_id,provider_payment_id")
      .eq("provider_order_id",dataId).maybeSingle();
    if(mobilityLookupError&&mobilityLookupError.code!=="42P01")throw mobilityLookupError;
    if(mobilityInvoice){
      return await handleMobilityFeeOrder(admin,dataId,mobilityInvoice);
    }

    // If an authentic provider-signed webhook arrives *before* the initial
    // Pix QR response could be committed, recover only a permanently prepared
    // invoice whose exact external_reference belongs to TAMÃO. Check ownership
    // with the platform's token, never with untrusted webhook body fields.
    const mpToken=String(Deno.env.get("MERCADOPAGO_ACCESS_TOKEN")??"").trim();
    if(mercadoPagoConfigured(mpToken)){
      const candidate=await fetchProviderOrder(mpToken,dataId);
      if(candidate.response.ok){
        const externalRef=String(candidate.data?.external_reference??"");
        // Never reroute a mobility-fee payment to merchant billing even
        // when its local invoice is missing, inactive or inconsistent.
        if(externalRef.toLowerCase().startsWith("mobility-fee:")){
          if(!/^mobility-fee:[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(externalRef))
            return json({error:"MOBILITY_FEE_REFERENCE_INVALID"},409);
          const {data:preparedInvoice,error:prepareLookupError}=await admin
            .from("mobility_fee_pix_invoices_v1_837")
            .select("id,driver_id,status,external_reference,amount_cents,provider_order_id,provider_payment_id")
            .eq("external_reference",externalRef).maybeSingle();
          if(prepareLookupError)throw prepareLookupError;
          if(preparedInvoice&&preparedInvoice.status==="prepared"&&!preparedInvoice.provider_order_id){
            return await handleMobilityFeeOrder(admin,dataId,preparedInvoice,candidate.data);
          }
          return json({error:"MOBILITY_FEE_UNBOUND_PROVIDER_ORDER"},409);
        }
      }
    }

    return await handlePlatformBillingOrder(
      admin,
      dataId,
      body,
      String(Deno.env.get("MERCADOPAGO_ACCESS_TOKEN")??"").trim()
    );
  }catch(error){
    console.error(
      "billing-payment-webhook-mercadopago failed",
      error instanceof Error?error.message:String(error)
    );
    return json({error:"MERCADOPAGO_WEBHOOK_FAILED"},500);
  }
});
