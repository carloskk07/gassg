import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHmac} from 'node:crypto';

const helperSource=fs.readFileSync(new URL('../supabase/functions/_shared/mercadopago.js',import.meta.url),'utf8');
const webhook=fs.readFileSync(new URL('../supabase/functions/billing-payment-webhook-mercadopago/index.ts',import.meta.url),'utf8');
const {verifyMercadoPagoWebhook}=await import('data:text/javascript;base64,'+
  Buffer.from(helperSource).toString('base64'));

const secret='sandbox-proof-secret-for-cryptographic-test-only';
const dataId='TAMAO-WEBHOOK-PROBE-2ecb9e18-8f2a-4447-b1ec-4535d5f28d05';
const timestamp=String(Date.now());
const buildRequest=({id=dataId,requestId='mp-simulator-req-123',
   key=secret,signatureOverride=null,headerRequestId=true}={})=>{
  const canonical='id:'+id.toLowerCase()+';'+
    (headerRequestId?'request-id:'+requestId+';':'')+
    'ts:'+timestamp+';';
  const digest=createHmac('sha256',key).update(canonical).digest('hex');
  const headers={'x-signature':signatureOverride??('ts='+timestamp+',v1='+digest)};
  if(headerRequestId)headers['x-request-id']=requestId;
  return new Request('https://example.invalid/functions/v1/billing-payment-webhook-mercadopago?data.id='+
    encodeURIComponent(id)+'&type=order',{method:'POST',headers,body:'{}'});
};

assert.equal(await verifyMercadoPagoWebhook(buildRequest(),secret,dataId),true,
 'valid normal simulator with ID and request-id must verify');
assert.equal(await verifyMercadoPagoWebhook(
  buildRequest({headerRequestId:false}),secret,dataId),true,
 'valid signature without optional x-request-id must be verified, not rejected');
assert.equal(await verifyMercadoPagoWebhook(
  buildRequest({id:dataId.toLowerCase()}),secret,dataId.toLowerCase()),true,
 'uppercase and lowercase IDs must both use documented lowercase manifest');
assert.equal(await verifyMercadoPagoWebhook(
  buildRequest({key:'attacker-controlled-secret-different'}),secret,dataId),false,
 'untrusted HMAC must remain rejected');
assert.equal(await verifyMercadoPagoWebhook(
  buildRequest({headerRequestId:false,key:'attacker-secret-with-no-request-id'}),secret,dataId),false,
 'optional request ID must not bypass digest verification');
assert.equal(await verifyMercadoPagoWebhook(
  buildRequest({requestId:'req-changed'}),secret,'SOME-OTHER-PROBE'),false,
 'changing resource ID must invalidate signature');
assert.equal(await verifyMercadoPagoWebhook(
  buildRequest({signatureOverride:'ts=123,v1=bad'}),secret,dataId),false,
 'malformed signatures still return 401');
assert.equal(await verifyMercadoPagoWebhook(
  buildRequest({signatureOverride:'not-a-signature'}),secret,dataId),false,
 'missing HMAC digest must be rejected');

const signedAt=webhook.indexOf('verifyMercadoPagoWebhook(req,webhookSecret,dataId)');
const probeAt=webhook.indexOf('return await handleWebhookProbe(',signedAt);
assert.ok(signedAt>=0&&probeAt>signedAt,'HMAC must run before read-only proof handler');
assert.ok(webhook.includes('MERCADOPAGO_PROBE_HMAC_REJECTED'),
 'safe signature diagnosis must exist for probe errors');
assert.ok(webhook.includes('signaturePresent:Boolean(header)')
  &&webhook.includes('requestIdPresent:Boolean(req.headers.get("x-request-id"))')
  &&webhook.includes('signatureShapeValid:/^\\d{9,16}$/.test(ts)'.replace('\\\\','\\')),
 'diagnostics report presence and syntax, not credentials');
const diagnosis=webhook.slice(webhook.indexOf('console.warn("MERCADOPAGO_PROBE_HMAC_REJECTED"'),webhook.indexOf('return json({error:"INVALID_MERCADOPAGO_SIGNATURE"},401)',signedAt));
assert.doesNotMatch(diagnosis,/console\.(?:warn|log|error)\([^)]*webhookSecret/);
assert.doesNotMatch(diagnosis,/JSON\.stringify\(\s*(req|headers|body|raw)\s*\)/);
console.log('PASS: Mercado Pago signed webhook optional x-request-id, HMAC safety, read-only probe diagnostics.');
