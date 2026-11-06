import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Real revenda frontend functions, no remote API / test money / new Pix.
const code=fs.readFileSync(new URL('../js/merchant.js',import.meta.url),'utf8');
const take=(a,b)=>{
 const from=code.indexOf(a),to=code.indexOf(b,from+a.length);
 assert.ok(from>0&&to>from,'missing code boundary '+a);
 return code.slice(from,to);
};
const lazy=fs.readFileSync(new URL('../js/merchant-billing-flow.js',import.meta.url),'utf8');
const source=lazy+'\n'+
 take('function merchantAcceptVerifiedBillingPix(result,merchantId){',
 'function merchantBenefitsContractSection(r)');
new vm.Script(source);
const MID='11111111-1111-4111-8111-111111111111';
const A='22222222-2222-4222-8222-222222222222';
const B='33333333-3333-4333-8333-333333333333';
const REQUEST='44444444-4444-4444-8444-444444444444';
const OTHER='55555555-5555-4555-8555-555555555555';
const br='00020101021100000000000000000000000000000000001';
const due='2099-01-01T00:00:00.000Z';
const qr='data:image/png;base64,aGVsbG8=';
const link='https://www.mercadopago.com.br/payments/revenda';
const charge=(id='PSP-857')=>({id,status:'active',provider:'mercadopago',
 correlationId:'66666666-6666-4666-8666-666666666666',amountCents:990,
 expiresAt:due,brCode:null,providerVerified:false});
const request=(kind='package_purchase',id=REQUEST)=>({
 id,requestKind:kind,planKey:kind==='package_purchase'?'essential':null,
 statementId:kind==='statement_payment'?'statement-857':null,
 refundRecoveryId:kind==='refund_recovery'?'recovery-857':null,
 expectedAmountCents:990,status:'pending',pixCharge:charge()
});
function fixture(kind='package_purchase'){
 const timer=[],handlers={},clips=[],toasts=[],renders=[];
 let visible='visible';
 const rt={status:'ready',merchant:{merchantId:MID,memberRole:'owner'},
  selectedMerchantId:MID,session:{user:{id:A}},accessEpoch:4,
  billing:{paymentRequests:[request(kind)]}};
 const ctx=vm.createContext({
  globalThis:null,merchantRuntime:rt,render:()=>renders.push('render'),
  document:{get visibilityState(){return visible},
    addEventListener:(event,fn)=>handlers[event]=fn},
  setTimeout:(fn,ms)=>{const t={fn,ms,cancelled:false};timer.push(t);return t},
  clearTimeout:t=>{t.cancelled=true},
  navigator:{clipboard:{writeText:async value=>{clips.push(value)}}},
  BRL:{format:n=>'R$ '+n.toFixed(2)},esc:x=>String(x??''),
  toast:s=>toasts.push(s),Date,String,Number
 });
 ctx.globalThis=ctx;ctx.merchantRuntime=rt;
 vm.runInContext(source+
  '\nthis.api={accept:merchantAcceptVerifiedBillingPix,'+
  'view:merchantBillingPixChargeView,copy:merchantCopyBillingPixCode,'+
  'proof:merchantBillingPixProof,hide:merchantHideVerifiedBillingPix,'+
  'valid:merchantBillingPixProofValid};',ctx);
 const row=rt.billing.paymentRequests[0];
 const ack=()=>({paymentRequestId:row.id,charge:{
  ...row.pixCharge,brCode:br,qrCodeDataUri:qr,paymentLinkUrl:link,
  status:'active',provider:'mercadopago',correlationId:row.pixCharge.correlationId,
  amountCents:990,expiresAt:due}});
 return {rt,ctx,row,api:ctx.api,ack,timer,handlers,clips,toasts,renders,
  hide:()=>{visible='hidden';handlers.visibilitychange()},
  show:()=>{visible='visible';handlers.visibilitychange()}};
}
for(const kind of ['package_purchase','statement_payment','refund_recovery']){
 const x=fixture(kind);
 // DB-active is NOT fresh PSP evidence. No QR before an explicit API recheck.
 assert.doesNotMatch(x.api.view(x.row),/QR ATIVO|Pix copia e cola|Abrir pagamento/);
 assert.match(x.api.view(x.row),/Conferir e mostrar Pix/);
 await x.api.copy(x.row.id);
 assert.equal(x.clips.length,0,'unverified database Pix cannot be copied');
 assert.equal(x.api.accept(x.ack(),MID),true);
 assert.equal(x.timer.length,1);
 assert.equal(x.timer[0].ms,45000);
 assert.match(x.api.view(x.row),/Pix pronto para pagar/);
 assert.match(x.api.view(x.row),/Pix copia e cola/);
 assert.match(x.api.view(x.row),/Abrir pagamento/);
 assert.match(x.api.view(x.row),/QR ATIVO/);
 await x.api.copy(x.row.id);
 assert.equal(x.clips[0],br,'Pix after valid lease should copy');
 assert.match(x.toasts.at(-1),/conferência/);
 assert.equal(x.api.valid(x.row),true);
 x.timer[0].fn();
 assert.equal(x.row.id,REQUEST,'timeout must retain original payment request');
 assert.equal(x.row.pixCharge.id,'PSP-857','timeout must retain original PSP identity');
 assert.equal(x.row.pixCharge.brCode,null);
 assert.equal(x.row.pixCharge.providerVerified,false);
 assert.doesNotMatch(x.api.view(x.row),/QR ATIVO|Pix copia e cola|Abrir pagamento/);
 await x.api.copy(x.row.id);
 assert.equal(x.clips.length,1,'expired proof cannot be copied');
 // Rechecking identical invoice (explicit owner click) re-arms without
 // creating a different payment request or paying anything.
 assert.equal(x.api.accept(x.ack(),MID),true);
 assert.match(x.api.view(x.row),/QR ATIVO/);
 const prior=x.timer.at(-1);
 x.hide();
 assert.equal(prior.cancelled,true);
 assert.equal(x.row.pixCharge.brCode,null);
 assert.doesNotMatch(x.api.view(x.row),/QR ATIVO|Pix copia e cola|Abrir pagamento/);
 x.show();
 assert.doesNotMatch(x.api.view(x.row),/Pix copia e cola/);
 // A status mismatch never authorizes display.
 const altered=x.ack();
 altered.charge.amountCents=991;
 assert.equal(x.api.accept(altered,MID),false);
 assert.doesNotMatch(x.api.view(x.row),/Pix copia e cola/);
}
// Existing merchant A proof cannot be displayed for merchant B, even when
// both merchants have pending charges with the same provider charge ID.
const switchCase=fixture();
assert.equal(switchCase.api.accept(switchCase.ack(),MID),true);
const staleTimer=switchCase.timer.at(-1);
switchCase.rt.session={user:{id:B}};
switchCase.rt.merchant={merchantId:'77777777-7777-4777-8777-777777777777',memberRole:'owner'};
switchCase.rt.selectedMerchantId=switchCase.rt.merchant.merchantId;
switchCase.rt.accessEpoch++;
const newRow=request('package_purchase',OTHER);
newRow.pixCharge={...charge(),brCode:'code for B',providerVerified:false};
switchCase.rt.billing={paymentRequests:[newRow]};
staleTimer.fn();
assert.equal(newRow.pixCharge.brCode,'code for B',
 'old timer must not erase another merchant charge');
assert.doesNotMatch(switchCase.api.view(newRow),/QR ATIVO|Pix copia e cola/);
await switchCase.api.copy(newRow.id);
assert.equal(switchCase.clips.length,0);

// Delayed clipboard completion after logout must not show a success toast
// on the next actor's panel. It must never start a new provider charge.
const delayed=fixture();
assert.equal(delayed.api.accept(delayed.ack(),MID),true);
let release;
delayed.ctx.navigator.clipboard.writeText=()=>new Promise(resolve=>{release=resolve});
const pending=delayed.api.copy(REQUEST);
assert.equal(typeof release,'function');
delayed.rt.session={user:{id:B}};
delayed.rt.accessEpoch++;
release();
await pending;
assert.doesNotMatch(delayed.toasts.join(' | '),/Código Pix copiado após conferência/);
assert.equal(delayed.rt.billing.paymentRequests[0].id,REQUEST);
console.log('PASS #857: merchant plan/statement/refund-recovery Pix only after PSP evidence lease; expiry, tab hiding, account isolation, no new charges.');
