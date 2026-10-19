import assert from 'node:assert/strict';
import fs from 'node:fs';
import {validatePixBrCode} from '../supabase/functions/_shared/pix-brcode.js';

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

const edge=fs.readFileSync(new URL('../supabase/functions/merchant-billing-pix/index.ts',import.meta.url),'utf8');
const merchant=fs.readFileSync(new URL('../js/merchant.js',import.meta.url),'utf8');
const backend=fs.readFileSync(new URL('../js/backend.js',import.meta.url),'utf8');
assert.match(edge,/validatePixBrCode\(brCode,\{expectedAmountCents\}\)/);
assert.match(edge,/validatePixBrCode\(existing\.br_code,\{expectedAmountCents\}\)/);
assert.match(edge,/PIX_PROVIDER_BR_CODE_INVALID/);
assert.match(merchant,/merchantBillingPixChargeExpired\(charge\)/);
assert.match(backend,/charge\.status==='completed'/);
assert.match(backend,/charge\.expiresAt/);

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
console.log('PASS: BR Code TLV, CRC16, valor, expiração e cópia protegida (sem transação real)');
