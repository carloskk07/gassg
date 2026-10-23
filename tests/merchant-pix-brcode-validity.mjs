import assert from 'node:assert/strict';
import fs from 'node:fs';
import {validatePixBrCode} from '../supabase/functions/_shared/pix-brcode.js';
import {mercadoPagoPixDeadline} from '../supabase/functions/_shared/mercadopago.js';

const tlv=(id,value)=>{
  assert.ok(value.length<=99);
  return id+String(value.length).padStart(2,'0')+value;
};
// Independent CRC16-CCITT calculation; no API calls or real PIX keys.
function crc(source){
  let result=0xffff;
  for(const byte of Buffer.from(source,'ascii')){
    result^=byte<<8;
    for(let bit=0;bit<8;bit++)
      result=((result&0x8000)?(result<<1)^0x1021:result<<1)&0xffff;
  }
  return result.toString(16).toUpperCase().padStart(4,'0');
}
function buildPix({amount='300.00',country='BR',currency='986',guid='br.gov.bcb.pix'}={}){
  const account=tlv('00',guid)+tlv('01','teste-interno-nao-pagavel');
  const fields=tlv('00','01')+tlv('01','12')+tlv('26',account)+
    tlv('52','0000')+tlv('53',currency)+
    (amount==null?'':tlv('54',amount))+tlv('58',country)+
    tlv('59','TAMAO TESTE')+tlv('60','BRASILIA')+
    tlv('62',tlv('05','***'))+'6304';
  return fields+crc(fields);
}
const valid=buildPix();
assert.equal(validatePixBrCode(valid,{expectedAmountCents:30000}).valid,true);
assert.equal(validatePixBrCode(buildPix({amount:null}),{expectedAmountCents:30000}).valid,true,
  'dynamic BR Code can omit the amount; provider order amount remains authoritative');
assert.equal(validatePixBrCode(valid,{expectedAmountCents:50000}).reason,
  'PIX_BR_CODE_AMOUNT_MISMATCH');
assert.equal(validatePixBrCode(buildPix({country:'US'})).valid,false);
assert.equal(validatePixBrCode(buildPix({currency:'840'})).valid,false);
assert.equal(validatePixBrCode(buildPix({guid:'not.pix'})).valid,false);
assert.equal(validatePixBrCode(buildPix({amount:'0.00'})).valid,false);
assert.equal(validatePixBrCode(valid.slice(0,-1)+'F').valid,false,
  'malformed CRC must never become a payable Pix');
assert.equal(validatePixBrCode(valid+'\n').valid,false);
assert.equal(validatePixBrCode(valid.slice(0,-8)+'6204FFFF').valid,false);
assert.equal(validatePixBrCode('https://mercadopago.com.br/payments/test').valid,false);

// The same provider order may be returned again for an idempotent POST.
 // Repeated recovery must not extend a Pix lifetime or re-offer a paid QR.
const baseNow=Date.parse('2026-10-22T18:00:00.000Z');
const hour=60*60*1000;
const preparedAt=new Date(baseNow-2*hour).toISOString();
const expectedDeadline=new Date(baseNow+22*hour).toISOString();
const orderWithoutDates={};
assert.equal(mercadoPagoPixDeadline(orderWithoutDates,{},preparedAt,baseNow),expectedDeadline);
assert.equal(mercadoPagoPixDeadline({created_date:new Date(baseNow).toISOString()}, {},preparedAt,baseNow),expectedDeadline,
  'provider GET time cannot extend the persisted issuance deadline');
assert.equal(mercadoPagoPixDeadline(orderWithoutDates,{},preparedAt,baseNow+4*hour),expectedDeadline,
  'time passing between retries must never reset the deadline');
assert.equal(mercadoPagoPixDeadline(orderWithoutDates,{},preparedAt,baseNow+23*hour),null,
  'expired issued charge cannot be made payable after idempotent recovery');
assert.equal(mercadoPagoPixDeadline(orderWithoutDates,{},null,baseNow),null,
  'missing persisted issuance anchor must fail closed');
assert.equal(mercadoPagoPixDeadline(orderWithoutDates,{},'not-a-time',baseNow),null);
const earlierProviderDate=new Date(baseNow-3*hour).toISOString();
assert.equal(mercadoPagoPixDeadline({created_date:earlierProviderDate},{},preparedAt,baseNow),
  new Date(baseNow+21*hour).toISOString(),'earlier provider creation restricts expiry');
const earlierExpiry=new Date(baseNow+hour).toISOString();
assert.equal(mercadoPagoPixDeadline(orderWithoutDates,{date_of_expiration:earlierExpiry},preparedAt,baseNow),
  earlierExpiry,'shorter provider expiry must win');
assert.equal(mercadoPagoPixDeadline(orderWithoutDates,{date_of_expiration:new Date(baseNow+30000).toISOString()},preparedAt,baseNow),null,
  'do not advertise almost-expired QR codes');
assert.equal(mercadoPagoPixDeadline({}, {},new Date(baseNow-25*hour).toISOString(),baseNow),null);

const edge=fs.readFileSync(new URL('../supabase/functions/merchant-billing-pix/index.ts',import.meta.url),'utf8');
const merchant=fs.readFileSync(new URL('../js/merchant.js',import.meta.url),'utf8');
const backend=fs.readFileSync(new URL('../js/backend.js',import.meta.url),'utf8');
assert.match(edge,/validatePixBrCode\(brCode,\{expectedAmountCents\}\)/);
assert.match(edge,/validatePixBrCode\(existing\.br_code,\{expectedAmountCents\}\)/);
assert.match(edge,/PIX_PROVIDER_BR_CODE_INVALID/);
assert.match(edge,/mercadoPagoPixDeadline\(order,payment,chargeCreatedAt\)/);
assert.match(edge,/end_to_end_id,created_at/);
assert.match(edge,/String\(existing\?\.created_at\?\?""\)/);
assert.match(edge,/PIX_PROVIDER_CHARGE_EXPIRED_OR_UNVERIFIED/);
assert.match(edge,/PIX_PROVIDER_ALREADY_PROCESSED/);
assert.match(edge,/const originalDeadline=mercadoPagoPixDeadline\(null,null,String\(existing\.created_at\?\?""\)\)/);
assert.match(edge,/savedExpiration>Date\.parse\(originalDeadline\)/);
assert.match(edge,/!Number\.isFinite\(savedExpiration\)/);
assert.doesNotMatch(edge,/expiresAt:new Date\(Date\.now\(\)\+86400_000\)/);
assert.match(merchant,/merchantBillingPixChargeExpired\(charge\)/);
assert.match(backend,/charge\?\.status==='completed'/);
assert.match(backend,/charge\.expiresAt/);

// Unknown provider expiry must be non-payable even if a stale row claims "active".
const expiryStart=merchant.indexOf('function merchantBillingPixChargeExpired(');
const expiryEnd=merchant.indexOf('\nfunction merchantBillingPixChargeView(',expiryStart);
assert.ok(expiryStart>=0&&expiryEnd>expiryStart);
const expiryGuard=new Function(merchant.slice(expiryStart,expiryEnd)+
  ';return merchantBillingPixChargeExpired;')();
assert.equal(expiryGuard({status:'active',expiresAt:null}),true);
assert.equal(expiryGuard({status:'active',expiresAt:'not-a-date'}),true);
assert.equal(expiryGuard({status:'active',expiresAt:'2000-01-01T00:00:00Z'}),true);
assert.equal(expiryGuard({status:'active',expiresAt:'2099-01-01T00:00:00Z'}),false);
assert.equal(expiryGuard({status:'completed',expiresAt:null}),false);
assert.match(merchant,/Prazo do Pix não confirmado/);

assert.match(edge,/if\(status==="COMPLETED"\)/);
assert.match(edge,/PIX_PROVIDER_ALREADY_PROCESSED/);
assert.match(edge,/const expiresAt=parseIso\(charge\.expiresDate\)/);
assert.match(edge,/Date\.parse\(expiresAt\)<=Date\.now\(\)\+60_000/);
const expiryMigration=fs.readFileSync(new URL(
  '../supabase/migrations/20261023233500_pix_provider_expiry_fail_closed.sql',
  import.meta.url),'utf8');
assert.ok(expiryMigration.includes('PIX_PROVIDER_CHARGE_EXPIRY_REQUIRED'));
assert.ok(expiryMigration.includes('PIX_CHARGE_EXPIRY_BASELINE_DRIFT_BLOCKED'));
assert.ok(!expiryMigration.includes('UPDATE public.platform_launch_control'));

// User cannot copy a known-expired or cancelled provider code.
const start=merchant.indexOf('async function merchantCopyBillingPixCode(');
const end=merchant.indexOf('\nasync function ',start+16);
assert.ok(start>=0&&end>start);
const source=merchant.slice(start,end);
const state={billing:{paymentRequests:[{
  id:'request-test',pixCharge:{status:'expired',brCode:valid,expiresAt:'2020-01-01T00:00:00Z'}
}]}};
let copied=0,notice='';
const fn=new Function('globalThis','merchantBillingPixChargeExpired','toast','navigator','document',
 source+';return merchantCopyBillingPixCode;')(
 {merchantRuntime:state},
 charge=>charge.status==='expired'||Date.parse(charge.expiresAt)<=Date.now(),
 message=>{notice=message},
 {clipboard:{writeText:async()=>{copied++}}},
 {});
await fn('request-test');
assert.equal(copied,0);
assert.match(notice,/expirado ou indisponível/);
console.log('PASS: BR Code, expiry anchored to persistent issuance, idempotent retry and copy guard (no real payment)');
