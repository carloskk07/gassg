import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const js=read('js/customer.js'),backend=read('js/backend.js'),css=read('css/components.css');
new vm.Script(js,{filename:'customer.js'});
new vm.Script(backend,{filename:'backend.js'});
const esc=x=>String(x??'').replaceAll('&','&amp;').replaceAll('<','&lt;')
 .replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const begin=js.indexOf('const statusCopy={');
const end=js.indexOf('\nfunction tracking(){',begin);
assert.ok(begin>=0&&end>begin);
const runtime={
 status:'ready',error:null,actionPending:false,order:null,orderId:'order-384',
 orderCheckedAt:new Date().toISOString(),orderCheckedId:'order-384'
};
const toastMessages=[];
const fields={
 'support-category':{value:'late'},
 'support-message':{value:'A entrega não apareceu'},
 'support-submit':{disabled:false}
};
const inline={textContent:''};
const doc={
 querySelector:selector=>selector==='#support-category'?fields['support-category']
  :selector==='#support-message'?fields['support-message']
  :selector==='#support-submit'?fields['support-submit']
  :selector==='#support-inline-feedback'?inline:null
};
const ctx=vm.createContext({
 globalThis:{liveReady:()=>true,liveRuntime:runtime},liveRuntime:runtime,esc,
 document:doc,toast:s=>toastMessages.push(s),shell:x=>x,
 BRL:{format:n=>'R$ '+Number(n).toFixed(2).replace('.',',')},
 paymentLabel:()=> 'Pix',formatDeliveryWindow:()=> 'Entre 15h e 17h',
 formatDeliveryPhone:()=> '***',hhmm:()=> '14:00',
 liveOpenSupportCase:async(category,message)=>({ok:true,case:{category,status:'open'}})
});
vm.runInContext(js.slice(begin,end),ctx);
const run=s=>vm.runInContext(s,ctx);
function order(status='PREPARING',cases=[],{age=0,error=null}={}){
 runtime.error=error;
 runtime.orderCheckedAt=new Date(Date.now()-age*60_000).toISOString();
 runtime.orderCheckedId='order-384';
 runtime.order={
  orderId:'order-384',publicCode:'TAM-384',status,orderId:'order-384',
  totalCents:12600,paymentMethod:'pix',postalCode:'97300000',
  address:'Rua Teste, 12',supplierName:'Revenda Teste',events:[],
  items:[{quantity:1,productName:'Água 20 L',lineTotalCents:12600}],
  supportCases:cases
 };
 return run('liveTracking()');
}
const now=new Date(Date.now()-2*60_000).toISOString();
const caseOpen={id:'1',category:'late',status:'open',createdAt:now};
const inReview={id:'2',category:'wrong_item',status:'in_review',createdAt:now};
const resolved={id:'3',category:'delivery',status:'resolved',createdAt:now,resolvedAt:now};
const closed={id:'4',category:'other',status:'closed',createdAt:now,resolvedAt:now};
let html=order('PREPARING',[caseOpen,inReview,resolved,closed]);
assert.match(html,/Atendimento do seu pedido/);
assert.match(html,/Atendimentos deste pedido/);
for(const status of ['Aberto','Em análise','Resolvido','Encerrado'])assert.ok(html.includes(status));
assert.match(html,/Registrado em/);
assert.match(html,/Encerramento registrado em/);
assert.match(html,/Situações registradas na última consulta deste pedido/);
assert.match(html,/Já existe um atendimento de atraso em acompanhamento/);
assert.match(html,/id="support-submit"[^>]+disabled/);
assert.match(html,/id="support-inline-feedback"[^>]+role="status" aria-live="polite"/);
assert.match(html,/onchange="customerSupportCategoryChanged\(\)"/);
assert.match(html,/maxlength="1000"/);
assert.match(html,/Conte em poucas palavras \(opcional\)/);
assert.doesNotMatch(html,/prazo de resposta garantido|resolvido em 24h|resposta imediata/i);
html=order('PREPARING',[{category:'__proto__',status:'constructor',
 createdAt:'2035-01-01T10:00:00Z',internalPhone:'11999999999'}]);
assert.match(html,/Assunto registrado/);
assert.match(html,/Status não confirmado/);
assert.doesNotMatch(html,/constructor|__proto__|11999999999|2035/);
html=order('PREPARING',[{
 category:'price_payment',status:'open',createdAt:now,
 message:'<script>alert(1)</script>',operator:'João'
}]);
assert.match(html,/Preço ou pagamento/);
assert.doesNotMatch(html,/<script>|João/);
html=order('PREPARING',[]);
assert.doesNotMatch(html,/Atendimentos deste pedido/);
assert.doesNotMatch(html,/id="support-submit"[^>]+disabled/);
html=order('PREPARING',[caseOpen],{age:12});
assert.match(html,/Estas são as informações da última consulta disponível/);
assert.match(html,/Atualizar atendimentos/);
assert.match(html,/Última consulta deste pedido há 12 min/);
html=order('PREPARING',[caseOpen],{error:'offline'});
assert.match(html,/Atualizar atendimentos/);
assert.match(html,/Acompanhamento temporariamente sem conexão/);
html=order('CANCELLED',[resolved]);
assert.match(html,/Atendimentos deste pedido/);
assert.match(html,/Resolvido/);
html=order('SETTLED',[closed]);
assert.match(html,/Atendimentos deste pedido/);
assert.match(html,/Avaliar|Tudo certo com a entrega/);

runtime.order.supportCases=[caseOpen];
fields['support-category'].value='late';
run('customerSupportCategoryChanged()');
assert.equal(fields['support-submit'].disabled,true);
assert.match(inline.textContent,/Já existe um atendimento deste tipo/);
fields['support-category'].value='no_show';
run('customerSupportCategoryChanged()');
assert.equal(fields['support-submit'].disabled,false);
assert.match(inline.textContent,/registro ficará vinculado/);

const casesBefore=runtime.order.supportCases.length;
fields['support-category'].value='late';
await run('openSupportCaseFromUi()');
assert.equal(runtime.order.supportCases.length,casesBefore,'UI cannot forge case state');
assert.ok(toastMessages.some(s=>s.includes('já está em acompanhamento')));
fields['support-category'].value='no_show';
fields['support-message'].value='  Não chegou  ';
const submitted=[];
ctx.liveOpenSupportCase=async(category,message)=>{
 submitted.push({category,message});
 assert.equal(fields['support-submit'].disabled,true,'button locked while submitting');
 return {ok:true,case:{status:'open'}};
};
await run('openSupportCaseFromUi()');
assert.equal(submitted.length,1);
assert.equal(submitted[0].category,'no_show');
assert.equal(submitted[0].message,'Não chegou');
assert.ok(toastMessages.some(s=>s.includes('Problema registrado. Consulte')));
assert.equal(fields['support-submit'].disabled,false);
ctx.liveOpenSupportCase=async()=>({ok:true,alreadyOpen:true});
await run('openSupportCaseFromUi()');
assert.ok(toastMessages.some(s=>s.includes('já estava em acompanhamento')));
ctx.liveOpenSupportCase=async()=>({ok:true,refreshPending:true});
await run('openSupportCaseFromUi()');
assert.ok(toastMessages.some(s=>s.includes('Atualize o pedido para ver o andamento')));
let release;
ctx.liveOpenSupportCase=()=>new Promise(resolve=>{release=resolve});
const pending=run('openSupportCaseFromUi()');
assert.equal(fields['support-submit'].disabled,true);
await run('openSupportCaseFromUi()');
release({ok:true});
await pending;
assert.equal(fields['support-submit'].disabled,false);
ctx.liveOpenSupportCase=async()=>{throw new Error('falha de rede')};
await run('openSupportCaseFromUi()');
assert.equal(fields['support-submit'].disabled,false);
assert.ok(toastMessages.some(s=>s.includes('falha de rede')));

const bStart=backend.indexOf('async function liveOpenSupportCase(');
const bEnd=backend.indexOf('const CUSTOMER_FINANCIAL_REFRESH_MS',bStart);
assert.ok(bStart>=0&&bEnd>bStart);
const code=backend.slice(bStart,bEnd);
const calls=[];
const serverOrder={orderId:'order-384'};
let refreshFailure=false;
const bg=vm.createContext({
 liveRuntime:{order:serverOrder,error:null},
 liveIdempotency:()=> 'case:uuid384',
 retryAmbiguousOnce:async fn=>fn(),
 liveInvoke:async(name,payload,opts)=>{
  calls.push({name,payload,opts});
  return {ok:true,case:{id:'c384',status:'open',category:'late'}};
 },
 liveGetOrder:async()=>{if(refreshFailure)throw Error('failed refresh')},
 render:()=>calls.push({name:'render'})
});
vm.runInContext(code,bg);
const good=await vm.runInContext("liveOpenSupportCase('late','Precisa de ajuda')",bg);
assert.equal(good.refreshPending,false);
assert.equal(good.case.status,'open');
assert.equal(calls[0].payload.action,'open-case');
assert.equal(calls[0].payload.orderId,'order-384');
assert.equal(calls[0].opts.idempotencyKey,'case:uuid384');
refreshFailure=true;
const acknowledged=await vm.runInContext("liveOpenSupportCase('late','Precisa de ajuda')",bg);
assert.equal(acknowledged.refreshPending,true);
assert.equal(acknowledged.case.id,'c384');
assert.match(bg.liveRuntime.error,/Não foi possível atualizar os atendimentos/);
assert.equal(calls.filter(x=>x.name==='customer-care').length,2,
 'no automatic duplicate submit after an acknowledged but unrefreshed case');
assert.doesNotMatch(code,/localStorage|sessionStorage|window\.confirm|adminPerform\(/);
for(const needle of ['.customer-care-history','.customer-care-case-status',
 '.customer-care-form-feedback','@media(max-width:620px)',
 '@media(max-width:370px)','@media(prefers-reduced-motion:reduce)'])
 assert.ok(css.includes(needle),'missing mobile accessibility rule '+needle);
assert.ok(read('supabase/functions/get-order/index.ts').includes(
 '.select("id,category,status,created_at,resolved_at")'),
 'support history is backed by order-scoped server fields');
assert.ok(read('.github/workflows/audit.yml').includes(
 'node tests/customer-care-clarity-v1-384.mjs'));
console.log('TAMÃO V1.384 PASS — verified case statuses, privacy, duplicate category, double-tap lock, refresh ambiguity and mobile feedback.');
