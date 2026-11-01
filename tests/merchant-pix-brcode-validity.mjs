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
  '../supabase/migrations/20261023233436_pix_provider_expiry_fail_closed.sql',
  import.meta.url),'utf8');
assert.ok(expiryMigration.includes('PIX_PROVIDER_CHARGE_EXPIRY_REQUIRED'));
assert.ok(expiryMigration.includes('PIX_CHARGE_EXPIRY_BASELINE_DRIFT_BLOCKED'));
assert.ok(!expiryMigration.includes('UPDATE public.platform_launch_control'));

// Execute the ACTUAL Woovi normalization logic against isolated fake PSP
// responses. No provider request, real identifier, balance or charge is made.
const wooviStart=edge.indexOf('function normalizeWooviCharge(');
const wooviEnd=edge.indexOf('\nasync function getWooviCharge(',wooviStart);
assert.ok(wooviStart>=0&&wooviEnd>wooviStart);
const wooviSource=edge.slice(wooviStart,wooviEnd)
  .replace('data:any,correlationId:string,expectedAmountCents:number',
    'data,correlationId,expectedAmountCents');
class FakeDomainError extends Error{
  constructor(code,message,status){super(message);this.code=code;this.status=status}
}
const normalizeWoovi=new Function(
  'DomainError','parseIso','cleanText','validatePixBrCode','safeWooviUrl',
  wooviSource+';return normalizeWooviCharge;'
)(
  FakeDomainError,
  v=>v&&Number.isFinite(Date.parse(String(v)))?new Date(v).toISOString():null,
  (v,max)=>typeof v==='string'&&v.length>0&&v.length<=max?v:null,
  validatePixBrCode,
  ()=>null
);
const later=new Date(Date.now()+3600000).toISOString();
const fakeCharge={charge:{
  correlationID:'test-woovi-only',value:30000,status:'ACTIVE',
  brCode:valid,globalID:'fake-provider-charge',expiresDate:later
}};
assert.equal(normalizeWoovi(fakeCharge,'test-woovi-only',30000).expiresAt,later);
const fakeWooviError=(charge,expectedCode)=>assert.throws(
  ()=>normalizeWoovi({charge},'test-woovi-only',30000),
  e=>e instanceof FakeDomainError&&e.code===expectedCode
);
fakeWooviError({...fakeCharge.charge,status:'COMPLETED'},'PIX_PROVIDER_ALREADY_PROCESSED');
fakeWooviError({...fakeCharge.charge,expiresDate:null},'PIX_PROVIDER_CHARGE_EXPIRED_OR_UNVERIFIED');
fakeWooviError({...fakeCharge.charge,expiresDate:'unparseable'},'PIX_PROVIDER_CHARGE_EXPIRED_OR_UNVERIFIED');
fakeWooviError({...fakeCharge.charge,expiresDate:'2020-01-01T00:00:00Z'},'PIX_PROVIDER_CHARGE_EXPIRED_OR_UNVERIFIED');
fakeWooviError({...fakeCharge.charge,expiresDate:new Date(Date.now()+30000).toISOString()},
  'PIX_PROVIDER_CHARGE_EXPIRED_OR_UNVERIFIED');

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

// A successful provider POST is not proof the DB commit is still active.
// Exercise the actual production fail-closed guard with synthetic valid Pix.
const guardStart=edge.indexOf('function assertPayableCommittedCharge(');
const guardEnd=edge.indexOf('function publicCharge(',guardStart);
assert.ok(guardStart>0&&guardEnd>guardStart,'post-commit guard must exist');
const guardSource=edge.slice(guardStart,guardEnd)
  .replace('charge:any,expectedAmountCents:number','charge,expectedAmountCents');
const assertPayable=new Function('DomainError','validatePixBrCode',
  guardSource+';return assertPayableCommittedCharge;')(
  FakeDomainError,validatePixBrCode);
const fresh={status:'active',amountCents:30000,brCode:valid,
  expiresAt:new Date(Date.now()+3600000).toISOString()};
assert.strictEqual(assertPayable(fresh,30000),fresh);
for(const state of ['expired','cancelled','completed','preparing','unknown']){
  assert.throws(()=>assertPayable({...fresh,status:state},30000),
    e=>e instanceof FakeDomainError &&
      (state==='completed'?e.code==='PIX_PROVIDER_ALREADY_PROCESSED'
        :e.code==='PIX_COMMITTED_CHARGE_NOT_PAYABLE'),
    'charge state '+state+' must never expose a payable QR');
}
for(const rejected of [
  {...fresh,amountCents:29999},
  {...fresh,brCode:'INVALID_BR_CODE'},
  {...fresh,expiresAt:null},
  {...fresh,expiresAt:'not-a-date'},
  {...fresh,expiresAt:new Date(Date.now()-1000).toISOString()},
  {...fresh,expiresAt:new Date(Date.now()+30000).toISOString()}
]){
  assert.throws(()=>assertPayable(rejected,30000),
    e=>e instanceof FakeDomainError&&e.code==='PIX_COMMITTED_CHARGE_NOT_PAYABLE',
    'invalid committed QR must be blocked');
}
const publicStart=edge.indexOf('function publicCharge(');
const publicEnd=edge.indexOf('function chargeComment(',publicStart);
assert.ok(publicStart>0&&publicEnd>publicStart);
const publicSource=edge.slice(publicStart,publicEnd).replace('row:any','row');
const safePublic=new Function(publicSource+';return publicCharge;')();
for(const state of ['completed','expired','cancelled','preparing']){
  const exposed=safePublic({id:'test',status:state,br_code:valid,
    qr_code_data_uri:'PRIVATE_QR_IMAGE',payment_link_url:'https://example.test/pay'});
  assert.equal(exposed.brCode,null,'never return previously paid or expired Pix');
  assert.equal(exposed.qrCodeDataUri,null);
  assert.equal(exposed.paymentLinkUrl,null);
}
assert.equal(safePublic({status:'active',br_code:valid}).brCode,valid);
assert.match(edge,/assertPayableCommittedCharge\(committed,expectedAmountCents\);/);
assert.ok(edge.indexOf('assertPayableCommittedCharge(committed,expectedAmountCents)')>
  edge.indexOf('merchant_billing_provider_charge_commit'));


// Exercise the actual Mercado Pago charge normalization and saved-QR provider
// recheck (synthetic provider responses only; no PSP or commercial mutation).
const mpStart=edge.indexOf('function normalizeMercadoPagoOrder(');
const mpEnd=edge.indexOf('\nasync function createMercadoPagoOrder(',mpStart);
const mpNormalizeSource=edge.slice(mpStart,mpEnd).replace(
  'order:any,correlationId:string,expectedAmountCents:number,chargeCreatedAt:string',
  'order,correlationId,expectedAmountCents,chargeCreatedAt'
);
assert.ok(mpStart>0&&mpEnd>mpStart);
const cents=v=>{
  if(v==null||v==='')return null;
  const n=Number(v)*100;
  return Number.isSafeInteger(n)?n:null;
};
const clean=(v,max)=>typeof v==='string'&&v.length>0&&v.length<=max?v:null;
const normalizeMp=new Function('DomainError','cleanText','moneyToCents',
  'validatePixBrCode','mercadoPagoPixDeadline','mercadoPagoQrDataUri','safeMercadoPagoUrl','mpPayment',
  mpNormalizeSource+';return normalizeMercadoPagoOrder;')(
  FakeDomainError,clean,cents,validatePixBrCode,mercadoPagoPixDeadline,
  ()=>null,()=>null,
  order=>(order?.transactions?.payments||[]).find(p=>p.payment_method?.id==='pix')??null
);
const testCorrelation='11111111-1111-4111-8111-111111111111';
const testAnchor=new Date(Date.now()-60_000).toISOString();
const mpOrder={
  id:'TEST-ORDER-001',external_reference:testCorrelation,
  total_amount:'300.00',currency_id:'BRL',status:'action_required',live_mode:true,
  transactions:{payments:[{
    id:'TEST-PAYMENT-001',amount:'300.00',status:'pending',live_mode:true,
    payment_method:{id:'pix',type:'bank_transfer',qr_code:valid}
  }],refunds:[]}
};
const normalized=normalizeMp(mpOrder,testCorrelation,30000,testAnchor);
assert.equal(normalized.status,'active');
assert.equal(normalized.providerTransactionId,'TEST-PAYMENT-001');
for(const [name,mutate] of [
  ['individual transaction amount missing',x=>{delete x.transactions.payments[0].amount;}],
  ['individual transaction amount smaller',x=>{x.transactions.payments[0].amount='299.99';}],
  ['sandbox order',x=>{x.live_mode=false;}],
  ['sandbox payment',x=>{x.transactions.payments[0].live_mode=false;}],
  ['foreign currency',x=>{x.currency_id='USD';}],
  ['failed Pix with payable order',x=>{x.transactions.payments[0].status='failed';}],
  ['refunded Pix with payable order',x=>{x.transactions.payments[0].status_detail='refunded';}],
  ['pending reversal with payable order',x=>{x.transactions.refunds=[{status:'pending'}];}]
]){
  const candidate=structuredClone(mpOrder);mutate(candidate);
  assert.throws(()=>normalizeMp(candidate,testCorrelation,30000,testAnchor),
    e=>e.code==='PIX_PROVIDER_PAYMENT_PROOF_INVALID',name);
}

const savedStart=edge.indexOf('async function assertStoredChargeStillPayable(');
const savedEnd=edge.indexOf('// The provider may settle or expire a charge',savedStart);
assert.ok(savedStart>0&&savedEnd>savedStart,'provider recheck implementation');
const savedSource=edge.slice(savedStart,savedEnd)
  .replace('row:any,provider:string,expectedAmountCents:number,',
    'row,provider,expectedAmountCents,')
  .replace('mpAccessToken:string,wooviAppId:string',
    'mpAccessToken,wooviAppId')
  .replace('let current:any=null;','let current=null;');
let currentMp=structuredClone(mpOrder),lookupOk=true;
let mpReads=0,wooviReads=0;
let wooviResult={found:true,status:200,charge:null};
const recheck=new Function('DomainError','UUID_RE','mercadoPagoFetch',
  'readMercadoPagoJson','normalizeMercadoPagoOrder','getWooviCharge','wooviBase',
  savedSource+';return assertStoredChargeStillPayable;')(
  FakeDomainError,
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  async()=>{mpReads++;return {ok:lookupOk,status:lookupOk?200:503};},
  async()=>currentMp,
  normalizeMp,
  async()=>{wooviReads++;return wooviResult;},
  ()=> 'https://api.woovi.com'
);
const stored={
  status:'active',provider:'mercadopago',provider_charge_id:mpOrder.id,
  provider_transaction_id:mpOrder.transactions.payments[0].id,
  correlation_id:testCorrelation,amount_cents:30000,br_code:valid,
  created_at:testAnchor,
  expires_at:new Date(Date.now()+3_600_000).toISOString()
};
assert.equal(await recheck(stored,'mercadopago',30000,'fake-mp-token',''),stored);
assert.equal(mpReads,1,'reopen persisted Pix must reach provider');
const expectRecheckError=async(code,mutate)=>{
  currentMp=structuredClone(mpOrder);lookupOk=true;
  const local={...stored};
  mutate(currentMp,local);
  await assert.rejects(
    recheck(local,'mercadopago',30000,'fake-mp-token',''),
    e=>e.code===code,code
  );
};
await expectRecheckError('PIX_PROVIDER_ALREADY_PROCESSED',x=>{
  x.status='processed';x.transactions.payments[0].status='processed';
});
await expectRecheckError('PIX_PROVIDER_PAYMENT_PROOF_INVALID',x=>{
  x.transactions.payments[0].amount='301.00';
});
await expectRecheckError('PIX_PROVIDER_RECHECK_MISMATCH',x=>{
  x.transactions.payments[0].id='OTHER-PAYMENT';
});
await expectRecheckError('PIX_PROVIDER_RECHECK_MISMATCH',(x,l)=>{
  l.br_code=buildPix({amount:'299.99'});
});
await expectRecheckError('PIX_PROVIDER_RECHECK_MISMATCH',(x,l)=>{
  l.expires_at=new Date(Date.now()+25*hour).toISOString();
});
await expectRecheckError('PIX_PROVIDER_RECHECK_MISMATCH',(x,l)=>{
  l.amount_cents=20000;
});
await expectRecheckError('PIX_PROVIDER_RECHECK_UNAVAILABLE',()=>{lookupOk=false;});
currentMp=structuredClone(mpOrder);lookupOk=true;
const wooviStored={...stored,provider:'woovi',provider_charge_id:'WOOVI-CHARGE-001',
  provider_transaction_id:null};
wooviResult.charge={provider:'woovi',status:'active',
  providerChargeId:'WOOVI-CHARGE-001',providerTransactionId:null,
  correlationId:testCorrelation,amountCents:30000,brCode:valid,
  expiresAt:new Date(Date.now()+4*hour).toISOString()};
assert.equal(await recheck(wooviStored,'woovi',30000,'','fake-woovi-key'),wooviStored);
assert.equal(wooviReads,1,'Woovi must be queried on persisted replay too');
wooviResult.charge={...wooviResult.charge,status:'completed'};
await assert.rejects(recheck(wooviStored,'woovi',30000,'','fake-woovi-key'),
  e=>e.code==='PIX_PROVIDER_RECHECK_MISMATCH');
wooviResult.charge={...wooviResult.charge,status:'active',providerChargeId:'FOREIGN'};
await assert.rejects(recheck(wooviStored,'woovi',30000,'','fake-woovi-key'),
  e=>e.code==='PIX_PROVIDER_RECHECK_MISMATCH');
assert.match(edge,/await assertStoredChargeStillPayable\(/);
assert.ok(edge.indexOf('await assertStoredChargeStillPayable(')>
  edge.indexOf('if(existing?.br_code&&["active","completed"].includes(existing.status))'));
assert.match(edge,/provider_transaction_id,amount_cents,status,br_code/);


// A read-only merchant-orders refresh must NOT expose the saved active QR:
// the backend may only display payment credentials after the on-demand PSP GET.
const merchantOrdersSource=fs.readFileSync(new URL(
  '../supabase/functions/merchant-orders/index.ts',import.meta.url),'utf8');
const pixMapStart=merchantOrdersSource.indexOf('pixCharge:(()=>{');
const pixMapEnd=merchantOrdersSource.indexOf('providerCharges:(billingProviderCharges',pixMapStart);
assert.ok(pixMapStart>0&&pixMapEnd>pixMapStart);
const pixMapSource=merchantOrdersSource.slice(pixMapStart,pixMapEnd);
for(const key of ['brCode:null','qrCodeDataUri:null','paymentLinkUrl:null']){
  assert.ok(pixMapSource.includes(key),'merchant read snapshot hides '+key);
}
assert.doesNotMatch(pixMapSource,/brCode:charge\.br_code/);
const backendSource=fs.readFileSync(new URL('../js/backend.js',import.meta.url),'utf8');
const livePixStart=backendSource.indexOf('async function merchantCreateBillingPixLive(');
const livePixEnd=backendSource.indexOf('async function merchantRequestBillingPackageLive(',livePixStart);
assert.ok(livePixStart>0&&livePixEnd>livePixStart);
const livePixSource=backendSource.slice(livePixStart,livePixEnd);
assert.match(livePixSource,/await merchantRefresh\(\{silent:true\}\)/);
assert.match(livePixSource,/merchantAcceptVerifiedBillingPix/);
const connectStart=backendSource.indexOf('async function merchantPaymentConnectLive(');
const connectEnd=backendSource.indexOf('async function merchantUpdatePaymentRoutesLive(',connectStart);
assert.ok(connectStart>0&&connectEnd>connectStart);
assert.doesNotMatch(backendSource.slice(connectStart,connectEnd),
  /merchantAcceptVerifiedBillingPix/,'OAuth connection must never be gated by Pix verification');
const acceptStart=merchant.indexOf('function merchantAcceptVerifiedBillingPix(');
const acceptEnd=merchant.indexOf('function merchantBillingPixChargeExpired(',acceptStart);
assert.ok(acceptStart>0&&acceptEnd>acceptStart);
const acceptSource=merchant.slice(acceptStart,acceptEnd);
assert.match(acceptSource,/persisted\.id!==charge\.id/);
assert.match(acceptSource,/persisted\.correlationId!==charge\.correlationId/);
assert.match(acceptSource,/Number\(persisted\.amountCents\)!==Number\(charge\.amountCents\)/);
assert.match(acceptSource,/providerVerified:true/);

const viewStart=merchant.indexOf('function merchantBillingPixChargeView(');
const viewEnd=merchant.indexOf('function merchantBillingLiveView(',viewStart);
assert.ok(viewStart>0&&viewEnd>viewStart);
const viewSource=merchant.slice(viewStart,viewEnd);
const viewRuntime={merchant:{memberRole:'owner'},actionPending:false};
const billingView=new Function('globalThis','merchantBillingPixChargeExpired','BRL','esc',
  viewSource+';return merchantBillingPixChargeView;')(
    {merchantRuntime:viewRuntime},expiryGuard,
    new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}),v=>String(v)
  );
const unverifiedRequest={id:'request-123',requestKind:'package_purchase',
  planKey:'basic',expectedAmountCents:30000,pixCharge:{
    status:'active',amountCents:30000,brCode:valid,
    expiresAt:new Date(Date.now()+hour).toISOString(),
    providerVerified:false
  }};
const unverifiedHtml=billingView(unverifiedRequest);
assert.match(unverifiedHtml,/Conferir e mostrar Pix/);
assert.doesNotMatch(unverifiedHtml,/Pix copia e cola|QR ATIVO|<textarea|<img/);
const verifiedHtml=billingView({...unverifiedRequest,
  pixCharge:{...unverifiedRequest.pixCharge,providerVerified:true}});
assert.match(verifiedHtml,/Pix copia e cola/);
assert.match(verifiedHtml,/Copiar código Pix/);

// An actual provider-completed charge can have a different amount or an
// unresolved request. The merchant view must not label it as paid/settled.
const completedCharge={id:'fake-charge',status:'completed',
  amountCents:30000,paidAmountCents:30000,endToEndId:'FAKE-END-TO-END'};
const paymentRequest={id:'request-test',expectedAmountCents:30000,
  status:'pending',receivedAmountCents:null,pixCharge:completedCharge};
const pendingHtml=billingView(paymentRequest);
assert.match(pendingHtml,/Pagamento identificado pelo provedor/);
assert.match(pendingHtml,/Aguardando conciliação financeira/);
assert.doesNotMatch(pendingHtml,/Pagamento aprovado|Pix recebido\./);
const mismatchHtml=billingView({...paymentRequest,
  pixCharge:{...completedCharge,paidAmountCents:29999}});
assert.match(mismatchHtml,/Pix requer revisão financeira/);
assert.match(mismatchHtml,/R\\$\\s?300,00/);
assert.match(mismatchHtml,/R\\$\\s?299,99/);
assert.doesNotMatch(mismatchHtml,/Pagamento aprovado|Pix recebido\./);
const missingProofHtml=billingView({...paymentRequest,
  pixCharge:{...completedCharge,paidAmountCents:null}});
assert.match(missingProofHtml,/Pix requer revisão financeira/);
assert.match(missingProofHtml,/não confirmado/);
const cancelledHtml=billingView({...paymentRequest,
  status:'cancelled'});
assert.match(cancelledHtml,/Pix requer revisão financeira/);
const approvedHtml=billingView({...paymentRequest,
  status:'approved',receivedAmountCents:30000});
assert.match(approvedHtml,/Pagamento aprovado no Financeiro TAMÃO/);
const approvedMismatch=billingView({...paymentRequest,
  status:'approved',receivedAmountCents:29999});
assert.match(approvedMismatch,/Aguardando conciliação financeira/);
assert.doesNotMatch(approvedMismatch,/Pagamento aprovado no Financeiro TAMÃO/);

// Copying an unverified ACTIVE code is forbidden just as an expired one is.
state.billing.paymentRequests[0].pixCharge={
  status:'active',brCode:valid,expiresAt:new Date(Date.now()+hour).toISOString(),
  providerVerified:false
};
copied=0;
await fn('request-test');
assert.equal(copied,0,'no copy of an active-but-unverified stored QR');

console.log('PASS: BR Code, expiry anchored to persistent issuance, idempotent retry and copy guard (no real payment)');
