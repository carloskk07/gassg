import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=read('supabase/migrations/20261016100000_ads_mp_signed_inbox_v1_316.sql');
const edge=read('supabase/functions/ads-payment-webhook-mercadopago/index.ts');
const adminEdge=read('supabase/functions/admin-ops/index.ts');
const adminUi=read('js/admin-activations.js');
new vm.Script(adminUi,{filename:'admin-activations.js'});
for(const token of [
 'platform_ads_mp_inbox_v1_316','enable row level security',
 'revoke all on public.platform_ads_mp_inbox_v1_316',
 'grant select,insert on public.platform_ads_mp_inbox_v1_316 to service_role',
 "verified_by_provider_api=true","reconciled_automatically=false",
 'ads_mp_inbox_record_v1_316','admin_ads_mp_inbox_read_v1_316',
 "a.admin_role in ('superadmin','operations','readonly')",
 "p_currency <> 'BRL'","v_c.amount_cents<>p_amount_cents",
 'v_c.collector_id<>p_collector_id',
 'v_c.payment_id<>p_payment_id',
 "status in ('checkout_ready','payment_approved','payment_reversed')",
 'on conflict(event_key) do nothing',
 "'paymentApproved',false","'automaticReconciliation',false",
 "'webhookCannotMarkPaid',true","'adsLive',false"
])assert.ok(sql.includes(token),'SQL safety: '+token);
assert.ok(!/(?:insert|update)\s+(?:into\s+)?public\.platform_ads_psp_checkouts_v1_314/i.test(sql),
 'Webhook SQL must never promote Ads ledger state');
for(const token of [
 'ADS_MP_WEBHOOK_ENABLED','ADS_MP_WEBHOOK_SECRET','ADS_MP_ACCESS_TOKEN','ADS_MP_SELLER_ID',
 'verifyMercadoPagoWebhook(req,signatureSecret,paymentId)',
 'recentTimestamp(ts)','req.method!=="POST"',
 'MAX_BODY=16384','JSON.parse(raw)',
 'mercadoPagoFetch("/v1/payments/"+paymentId,{accessToken:token})',
 'String(payment?.id||"")!==paymentId',
 'collectorId!==sellerId',
 'currency!=="BRL"',
 'moneyToCents(payment?.transaction_amount)',
 'admin.rpc("ads_mp_inbox_record_v1_316"',
 'paymentApproved:false','automaticReconciliation:false',
 'ADM'
].filter(x=>x!=='ADM'))assert.ok(edge.includes(token),'Webhook proof: '+token);
assert.ok(!/\.rpc\("admin_ads_psp_action_v1_314"/.test(edge),
 'Webhooks must never call the payment settlement RPC');
assert.ok(edge.indexOf('verifyMercadoPagoWebhook(req,signatureSecret,paymentId)')<edge.indexOf('reason:"not_payment"'), 'Every acknowledged event must be cryptographically authenticated');
assert.ok(!/checkout\/preferences/.test(edge),
 'Webhooks must never create a checkout');
assert.ok(adminEdge.includes('if(action==="ads-mp-inbox-read")'));
assert.ok(adminEdge.includes('admin_ads_mp_inbox_read_v1_316'));
assert.ok(adminUi.includes("['adsMpInbox','ads-mp-inbox-read','admin_ads_mp_inbox_v1_316']"));
assert.ok(adminUi.includes('adminAdsMpInboxView()'));
assert.ok(adminUi.includes('async function adminAdsPspAction(merchantId,operation,prefilledPaymentId=null)'));
assert.ok(adminUi.includes("paymentId=String(prefilledPaymentId||prompt("));
let role='superadmin';const merchantId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const event={merchantId,merchantName:'Empresa Exemplo',paymentId:'123456789',
 providerStatus:'approved',amountCents:23400,receivedAt:'2026-10-15T22:00:00Z',
 checkoutStatus:'checkout_ready'};
const desk={actor:'actor',role,checkedAt:new Date().toISOString(),
 data:{adsMpInbox:{source:'admin_ads_mp_inbox_v1_316',readOnly:true,
  automaticReconciliation:false,webhookCannotMarkPaid:true,adsLive:false,
  totalEvents:1,rows:[event]},
  adsPsp:{platformPspConfigured:true,rows:[{merchantId,
    checkout:{status:'checkout_ready',version:2}}]}}};
const ctx=vm.createContext({
 adminRoleCanSection:()=>true,adminRuntime:{session:{user:{id:'actor'}}},
 adminCurrentRole:()=>role,adminActivationDesk:desk,Date,Number,String,
 esc:t=>String(t)
});
const tail=adminUi.slice(adminUi.indexOf('// V1.316 — signed provider events'));
vm.runInContext(tail+'\nthis.draw=adminAdsMpInboxView;',ctx);
assert.match(ctx.draw(),/Conferir agora no Mercado Pago/);
assert.match(ctx.draw(),/Nenhuma mudança automática de pagamento/);
role='readonly';desk.role='readonly';
assert.doesNotMatch(ctx.draw(),/onclick="adminAdsPspAction/);
console.log('V1.316 PASS — signed provider GET + HMAC, private inbox, human-led settlement only.');
