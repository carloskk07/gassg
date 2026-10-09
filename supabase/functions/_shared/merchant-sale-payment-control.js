import {
  decryptPaymentSecret,
  paymentEncryptionConfigured,
  sha256Hex
} from "./payment-secrets.js";
import {
  mercadoPagoFetch,
  readMercadoPagoJson,
  moneyToCents
} from "./mercadopago.js";

export class MerchantSalePaymentControlError extends Error{
  code:string;
  status:number;
  constructor(code:string,message=code,status=409){
    super(message);
    this.name="MerchantSalePaymentControlError";
    this.code=code;
    this.status=status;
  }
}

function primaryPayment(order:any){
  const payments=Array.isArray(order?.transactions?.payments)
    ?order.transactions.payments
    :[];
  return payments[0]??null;
}
function refunds(order:any){
  return Array.isArray(order?.transactions?.refunds)
    ?order.transactions.refunds
    :[];
}
function refundedCents(order:any){
  return refunds(order).reduce((sum:number,item:any)=>{
    const status=String(item?.status??"").trim().toLowerCase();
    if(status&& !["processed","approved","refunded"].includes(status))return sum;
    const cents=moneyToCents(item?.amount);
    return sum+(cents??0);
  },0);
}
function snapshot(order:any,attempt:any,forcedStatus:string|null=null){
  const payment=primaryPayment(order);
  const amountCents=moneyToCents(order?.total_amount);
  const refundCents=refundedCents(order);
  let status=String(
    forcedStatus
    ??payment?.status
    ??order?.status
    ??"unknown"
  ).trim().toLowerCase();
  if(refundCents>=Number(attempt.amount_cents))status="refunded";
  if(status==="approved"&&String(order?.status??"").toLowerCase()==="processed"){
    status="processed";
  }
  return {
    provider:"mercadopago",
    orderId:String(order?.id??"").trim(),
    paymentId:String(payment?.id??"").trim()||null,
    externalReference:String(order?.external_reference??"").trim(),
    amountCents,
    refundCents,
    status,
    statusDetail:String(
      payment?.status_detail??order?.status_detail??""
    ).trim().slice(0,240)||null
  };
}
function assertSnapshot(s:any,attempt:any){
  if(
    s.orderId!==String(attempt.provider_order_id??"")
    ||s.externalReference!==String(attempt.external_reference??"")
    ||s.amountCents!==Number(attempt.amount_cents)
    ||String(attempt.currency)!=="BRL"
  ){
    throw new MerchantSalePaymentControlError(
      "MERCHANT_PROVIDER_ORDER_MISMATCH",
      "O pagamento online divergiu do pedido e exige revisão.",
      409
    );
  }
}
async function fetchOrder(accessToken:string,providerOrderId:string){
  const response=await mercadoPagoFetch(
    "/v1/orders/"+encodeURIComponent(providerOrderId),
    {accessToken}
  );
  const data=await readMercadoPagoJson(response);
  if(!response.ok){
    throw new MerchantSalePaymentControlError(
      "MERCHANT_PROVIDER_LOOKUP_FAILED",
      "Não foi possível confirmar o estado do pagamento no provedor.",
      503
    );
  }
  return data;
}
async function applySnapshot(admin:any,attempt:any,s:any){
  const evidence=await sha256Hex(JSON.stringify(s));
  const providerEventId="control:"+evidence.slice(0,64);
  const {data,error}=await admin.rpc(
    "apply_merchant_sale_payment_event",
    {
      p_provider_event_id:providerEventId,
      p_provider_order_id:s.orderId,
      p_provider_payment_id:s.paymentId,
      p_event_type:"control."+s.status,
      p_provider_status:s.status,
      p_amount_cents:s.amountCents,
      p_currency:"BRL",
      p_occurred_at:new Date().toISOString(),
      p_raw_payload_sha256:evidence
    }
  );
  if(error)throw error;
  return data;
}
async function sellerAccessToken(admin:any,attempt:any){
  const key=String(
    Deno.env.get("MERCHANT_PAYMENT_TOKEN_ENCRYPTION_KEY")??""
  ).trim();
  if(!paymentEncryptionConfigured(key)){
    throw new MerchantSalePaymentControlError(
      "MERCHANT_PAYMENT_ENCRYPTION_NOT_CONFIGURED",
      "A conexão de pagamento está temporariamente indisponível.",
      503
    );
  }

  const {data:account,error}=await admin
    .from("merchant_payment_provider_accounts")
    .select("provider_account_id,status,access_token_ciphertext,access_token_nonce")
    .eq("merchant_id",attempt.merchant_id)
    .eq("provider","mercadopago")
    .maybeSingle();
  if(error)throw error;
  if(
    !account
    ||account.status!=="active"
    ||!account.access_token_ciphertext
    ||!account.access_token_nonce
  ){
    throw new MerchantSalePaymentControlError(
      "MERCHANT_PROVIDER_CONNECTION_UNAVAILABLE",
      "A conta de recebimento da revenda precisa ser reconectada antes desta operação.",
      409
    );
  }

  return await decryptPaymentSecret(
    account.access_token_ciphertext,
    account.access_token_nonce,
    key,
    "provider-account:"+attempt.merchant_id+":mercadopago:access"
  );
}

export async function releaseMerchantSalePaymentBeforeOrderChange(
  admin:any,
  orderId:string
){
  const {data:attempt,error}=await admin
    .from("merchant_sale_payment_attempts")
    .select("id,order_id,merchant_id,external_reference,amount_cents,currency,status,provider_order_id,provider_payment_id")
    .eq("order_id",orderId)
    .in("status",[
      "preparing","checkout_ready","pending","approved","review_required"
    ])
    .order("created_at",{ascending:false})
    .limit(1)
    .maybeSingle();
  if(error)throw error;
  if(!attempt)return {needed:false,terminal:true};

  if(!attempt.provider_order_id){
    if(attempt.status!=="preparing"){
      throw new MerchantSalePaymentControlError(
        "SALE_PAYMENT_PROVIDER_ORDER_MISSING",
        "O pagamento exige revisão antes de alterar o pedido.",
        409
      );
    }
    const now=new Date().toISOString();
    const {error:updateError}=await admin
      .from("merchant_sale_payment_attempts")
      .update({
        status:"cancelled",
        cancelled_at:now,
        updated_at:now,
        last_error_code:null,
        last_error_at:null
      })
      .eq("id",attempt.id)
      .eq("status","preparing");
    if(updateError)throw updateError;
    return {
      needed:true,
      terminal:true,
      action:"local_cancel",
      status:"cancelled"
    };
  }

  const accessToken=await sellerAccessToken(admin,attempt);
  let order=await fetchOrder(accessToken,attempt.provider_order_id);
  let state=snapshot(order,attempt);
  assertSnapshot(state,attempt);

  const paid=
    state.status==="processed"
    ||state.status==="approved"
    ||state.refundCents>0
    ||Number(order?.total_paid_amount??0)>0
    ||attempt.status==="approved";

  if(state.refundCents>=Number(attempt.amount_cents)){
    state=snapshot(order,attempt,"refunded");
  }else if(paid){
    const response=await mercadoPagoFetch(
      "/v1/orders/"+encodeURIComponent(attempt.provider_order_id)+"/refund",
      {
        accessToken,
        method:"POST",
        idempotencyKey:"refund:"+attempt.external_reference
      }
    );
    const data=await readMercadoPagoJson(response);
    if(
      !response.ok
      &&![409].includes(response.status)
    ){
      throw new MerchantSalePaymentControlError(
        "MERCHANT_PROVIDER_REFUND_FAILED",
        "O pagamento foi preservado porque o reembolso não pôde ser confirmado.",
        409
      );
    }
    order=await fetchOrder(accessToken,attempt.provider_order_id);
    state=snapshot(order,attempt);
    assertSnapshot(state,attempt);
    if(state.refundCents<Number(attempt.amount_cents)){
      throw new MerchantSalePaymentControlError(
        "MERCHANT_PROVIDER_REFUND_NOT_CONFIRMED",
        "O pedido não foi alterado porque o reembolso ainda não foi confirmado.",
        409
      );
    }
    state=snapshot(order,attempt,"refunded");
    void data;
  }else{
    const providerStatus=String(order?.status??"").trim().toLowerCase();
    if(!["canceled","cancelled","expired"].includes(providerStatus)){
      const response=await mercadoPagoFetch(
        "/v1/orders/"+encodeURIComponent(attempt.provider_order_id)+"/cancel",
        {
          accessToken,
          method:"POST",
          idempotencyKey:"cancel:"+attempt.external_reference
        }
      );
      await readMercadoPagoJson(response);
      if(!response.ok&&response.status!==409){
        throw new MerchantSalePaymentControlError(
          "MERCHANT_PROVIDER_CANCEL_FAILED",
          "O checkout foi preservado porque o cancelamento não pôde ser confirmado.",
          409
        );
      }
      order=await fetchOrder(accessToken,attempt.provider_order_id);
      state=snapshot(order,attempt);
      assertSnapshot(state,attempt);
    }
    if(!["canceled","cancelled","expired"].includes(state.status)){
      throw new MerchantSalePaymentControlError(
        "MERCHANT_PROVIDER_CANCEL_NOT_CONFIRMED",
        "O pedido não foi alterado porque o checkout ainda pode receber pagamento.",
        409
      );
    }
    if(state.status==="cancelled")state.status="canceled";
  }

  const applied=await applySnapshot(admin,attempt,state);
  const terminal=["cancelled","expired","refunded","rejected"].includes(
    String(applied?.status??"")
  );
  if(!terminal){
    throw new MerchantSalePaymentControlError(
      "SALE_PAYMENT_RELEASE_NOT_TERMINAL",
      "O pagamento ainda não atingiu um estado seguro para alterar o pedido.",
      409
    );
  }

  return {
    needed:true,
    terminal:true,
    action:String(applied?.status)==="refunded"?"refund":"cancel",
    status:applied?.status??null
  };
}
