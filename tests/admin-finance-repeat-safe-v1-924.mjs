import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const edge=read('supabase/functions/admin-ops/index.ts');
const ui=read('js/admin.js');
const start=edge.indexOf('async function adminFinanceLabLivePriorCompleted(');
const end=edge.indexOf('async function adminFinanceLabLivePix(',start);
assert(start>0&&end>start,'server must have guarded retry gate');
const source=edge.slice(start,end).replaceAll('admin:any','admin')
 .replaceAll('actorId:string','actorId').replaceAll('prior:any[]','prior')
 .replaceAll('(row:any)=>','(row)=>').replaceAll('(evt:any)=>','(evt)=>');
new vm.Script(source);
const ACTOR='11111111-1111-4111-8111-111111111111';
const OTHER='22222222-2222-4222-8222-222222222222';
const REF='tamao-finlab-live-reference-existing';
const ORDER='ORD_LIVE_PAID_ALREADY_1234';
const createdAt=new Date(Date.now()-90_000).toISOString();
const signedAt=new Date(Date.now()-60_000).toISOString();
const intent={id:'old-intent-1',target_id:REF,
 metadata:{amountCents:200,testPurpose:'coupons'},created_at:new Date(Date.now()-120_000).toISOString()};
const created={action:'finance_lab_live_pix_created',target_id:ORDER,created_at:createdAt,
 actor_user_id:ACTOR,
 metadata:{mode:'live',liveModeConfirmed:true,externalReference:REF,
 amountCents:200,testPurpose:'coupons',paymentId:'p-1'}};
const proof={action:'finance_lab_live_pix_webhook',actor_user_id:ACTOR,
 target_id:ORDER,created_at:signedAt,
 metadata:{mode:'live',provider:'mercadopago',signed:true,
 amountCents:200,providerProcessed:true,reversal:false,
 orderStatus:'processed',paymentStatus:'processed'}};
function fixture(opts={}){
 let rows=opts.rows||[created,proof],pspCalls=0;
 let psp=opts.psp??{providerProcessed:true,paymentAmountMatched:true,
  webhookProcessed:true,reversalObserved:false,credited:false,settlementVerified:false};
 const db={from(table){
  assert.equal(table,'platform_admin_audit');
  const filters=[];
  const chain={
   select(){return this},
   eq(k,v){filters.push(r=>r[k]===v);return this},
   gte(k,v){filters.push(r=>r[k]>=v);return this},
   in(k,v){filters.push(r=>v.includes(r[k]));return this},
   order(){return this},
   limit(n){this.n=n;return this},
   then(ok,err){return Promise.resolve({data:rows.filter(r=>filters.every(f=>f(r))).slice(0,this.n||100),
    error:null}).then(ok,err)}
  };
  return chain;
 }};
 const ctx=vm.createContext({Date,String,Number,Set,Array,
  DomainError:class extends Error{
   constructor(code,msg,status){super(msg);this.code=code;this.status=status;}
  },
  adminFinanceLabLiveCheck:async (_db,actor,body)=>{
   pspCalls++;
   assert.equal(actor,ACTOR);
   assert.equal(body.orderId,ORDER);
   if(psp instanceof Error)throw psp;
   return psp;
  }
 });
 vm.runInContext(source+';this.isSafe=adminFinanceLabLivePriorCompleted;',ctx);
 return {db,ctx,pspCalls:()=>pspCalls,setRows:v=>{rows=v},setPsp:v=>{psp=v}};
}
// Signed processed+matched webhook AND fresh exact PSP read permits a new consented test.
{
 const f=fixture();
 assert.equal(await f.ctx.isSafe(f.db,ACTOR,[intent]),true);
 assert.equal(f.pspCalls(),1,'PSP is checked by read-only GET route');
}
async function blocked(f,code='FINANCE_LAB_LIVE_ALREADY_ISSUED'){
 await assert.rejects(()=>f.ctx.isSafe(f.db,ACTOR,[intent]),
  e=>e.code===code&&e.status===409);
}
// Pending/no webhook, unsigned, incorrect amount, reversal, or cross-owner proof
// must never be replaced by a second charge.
for(const rows of [
 [created],
 [created,{...proof,metadata:{...proof.metadata,signed:false}}],
 [created,{...proof,metadata:{...proof.metadata,amountCents:300}}],
 [created,{...proof,metadata:{...proof.metadata,reversal:true}}],
 [created,{...proof,actor_user_id:OTHER}],
 [{...created,metadata:{...created.metadata,externalReference:'foreign'}},proof],
 [created,{...proof,created_at:new Date(Date.now()-300_000).toISOString()}]
]){const f=fixture({rows});await blocked(f);assert.equal(f.pspCalls(),0);}
for(const psp of [
 {providerProcessed:false,paymentAmountMatched:true,webhookProcessed:true,reversalObserved:false,credited:false,settlementVerified:false},
 {providerProcessed:true,paymentAmountMatched:true,webhookProcessed:false,reversalObserved:false,credited:false,settlementVerified:false},
 {providerProcessed:true,paymentAmountMatched:true,webhookProcessed:true,reversalObserved:true,credited:false,settlementVerified:false},
 new Error('Provider offline')
]){const f=fixture({psp});
 if(psp instanceof Error)await assert.rejects(()=>f.ctx.isSafe(f.db,ACTOR,[intent]),/Provider offline/);
 else await blocked(f);
 assert.equal(f.pspCalls(),1);
}
// Issuance flow must call this gate before another POST to Mercado Pago.
const issued=edge.slice(end,edge.indexOf('async function adminFinanceLabRecoverLivePix(',end));
assert.match(issued,/await adminFinanceLabLivePriorCompleted\(admin,actorId,/);
assert.ok(issued.indexOf('await adminFinanceLabLivePriorCompleted(')<
 issued.indexOf('mercadoPagoFetch("/v1/orders"'));
assert.match(issued,/limit:3,windowSeconds:3600/);
assert.match(issued,/body\?\.authorization!=="GERAR_PIX_REAL"/);
const lab=ui.slice(ui.indexOf('function adminFinanceLabView(d){'),
 ui.indexOf('function adminFinanceHomologationCatalog(){'));
assert.match(lab,/Gerar outro Pix real \(exige confirmação\)/);
assert.match(lab,/select class="input" id="admin-finance-lab-live-amount"/);
assert.match(lab,/\[100,200,300,500\]/);
const paid=lab.indexOf('adminFinanceLabLivePaymentBanner(state)');
const amount=lab.indexOf('<label for="admin-finance-lab-live-amount">');
const recover=lab.indexOf('admin-finance-lab-recovery');
const qr=lab.indexOf('adminFinanceLabLiveQrBlock(state.live)');
assert(paid>=0&&paid<amount,'last paid status before next-charge controls');
assert(qr>=0&&qr<recover,'payable QR cannot be hidden under collapsed recovery');
assert.match(read('.github/workflows/audit.yml'),/admin-finance-repeat-safe-v1-924\.mjs/);
console.log('V1.924 PASS: allow only paid+signed+rechecked repeat Pix, keep all ambiguous holds.');
