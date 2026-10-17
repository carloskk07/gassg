import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const customer=read('js/customer.js'),css=read('css/components.css');
new vm.Script(customer,{filename:'customer.js'});
const begin=customer.indexOf('const statusCopy={');
const end=customer.indexOf('\nfunction tracking(){',begin);
assert.ok(begin>0&&end>begin);
const source=customer.slice(begin,end);
const money=n=>'R$ '+Number(n).toFixed(2).replace('.',',');
const escape=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;')
 .replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const runtime={status:'ready',error:null,actionPending:false,order:null,
 orderCheckedAt:null,orderCheckedId:null};
const ctx=vm.createContext({
 globalThis:{liveReady:()=>true,liveRuntime:runtime},
 liveRuntime:runtime,esc:escape,BRL:{format:money},
 shell:html=>html,toast:()=>{},paymentLabel:()=> 'Dinheiro',
 formatDeliveryWindow:()=> 'Hoje entre 15h e 17h',
 formatDeliveryPhone:()=> '***',hhmm:()=> '12h'
});
vm.runInContext(source,ctx);
const run=x=>vm.runInContext(x,ctx);
const secs=(value,now)=>run('customerTrackingRemainingSeconds('+JSON.stringify(value)+','+now+')');
const now=Date.parse('2026-10-17T15:00:00.000Z');
assert.equal(secs(new Date(now+91500).toISOString(),now),92);
assert.equal(secs(new Date(now-1).toISOString(),now),0);
for(const value of [null,'','invalid','2026-10-99T18:00:00Z',
 '2026-10-17T20:00:00Zx',123]){
 assert.equal(secs(value,now),null,'unknown deadline must not be counted: '+String(value));
}
assert.equal(secs(new Date(now+35*86400000).toISOString(),now),null,
 'unreasonable distant timestamp is not a request countdown');
assert.equal(run('customerTrackingTotal(null)'),null);
assert.equal(run('customerTrackingTotal({})'),null);
assert.equal(run('customerTrackingTotal({totalCents:null})'),null);
assert.equal(run('customerTrackingTotal({totalCents:"nope"})'),null);
assert.equal(run('customerTrackingTotal({totalCents:-10})'),null);
assert.equal(run('customerTrackingTotal({totalCents:12000})'),120);
assert.equal(run('customerTrackingTotal({totalCents:0})'),0,
 'explicit confirmed zero is different from missing evidence');
const quoteBase={status:'REQUOTE_REQUIRED'};
const proposal=(previous,proposed,remaining,evidenceKind='recent')=>
 run('customerRequoteDecision('+JSON.stringify(quoteBase)+','+
   JSON.stringify(previous)+','+JSON.stringify(proposed)+','+
   JSON.stringify(remaining)+',{evidence:{kind:'+JSON.stringify(evidenceKind)+'}})');
let html=proposal(120,132,90);
assert.match(html,/Aceitar proposta de R\$ 132,00/);
assert.match(html,/onclick="confirmRequote\(\)" >/);
assert.match(html,/customer-requote-proof verified/);
for(const remaining of [null,0,-1]){
 html=proposal(120,132,remaining);
 assert.match(html,/onclick="confirmRequote\(\)" disabled/);
 assert.match(html,/Atualizar proposta/);
 assert.match(html,/customer-requote-proof needs-refresh/);
 assert.doesNotMatch(html,/NaN segundos|undefined segundos/);
}
assert.match(proposal(120,132,null),/Não foi possível verificar o prazo/);
html=proposal(120,132,45,'stale');
assert.match(html,/onclick="confirmRequote\(\)" disabled/);
assert.match(html,/consulta recente/);
html=proposal(null,132,45);
assert.match(html,/Valor anterior <strong>Não confirmado/);
assert.match(html,/onclick="confirmRequote\(\)" disabled/);
assert.equal(proposal(120,null,45),'');
assert.equal(proposal(120,0,45),'');
assert.equal(proposal(120,NaN,45),'',
 'malformed proposed total cannot generate an approval card');
runtime.actionPending=true;
assert.match(proposal(120,132,45),/onclick="confirmRequote\(\)" disabled/);
runtime.actionPending=false;
const action=(remaining,proposal=13200,kind='recent')=>
 run('customerTrackingPrimaryAction({status:"REQUOTE_REQUIRED",proposedTotalCents:'+
 JSON.stringify(proposal)+'},{evidence:{kind:'+JSON.stringify(kind)+
 '},remainingSeconds:'+JSON.stringify(remaining)+'})');
assert.match(action(40),/href="#customer-requote-decision"/);
for(const expiry of [null,0,-2]){
 assert.doesNotMatch(action(expiry),/href="#customer-requote-decision"/);
 assert.match(action(expiry),/Atualizar proposta/);
}
assert.match(action(40,13200,'stale'),/Atualizar pedido/);
assert.match(action(40,null),/Atualizar proposta/);

function render(status,{totalCents=12000,proposedTotalCents=null,offerExpiresAt=null,
  itemPrice=12000,evidenceTime=new Date().toISOString(),error=null}={}){
 runtime.error=error;
 runtime.order={
  orderId:'order-382',publicCode:'TAM-382',status,totalCents,
  proposedTotalCents,offerExpiresAt,
  paymentMethod:'cash',postalCode:'97300000',address:'Rua Teste, 12',
  items:[{quantity:1,product_name:'Água 20L',line_total_cents:itemPrice}],
  supportCases:[],events:[]
 };
 runtime.orderCheckedId='order-382';
 runtime.orderCheckedAt=evidenceTime;
 return run('liveTracking()');
}
let markup=render('REQUOTE_REQUIRED',{proposedTotalCents:13500,offerExpiresAt:'unknown'});
assert.match(markup,/Não foi possível verificar o prazo/);
assert.match(markup,/onclick="confirmRequote\(\)" disabled/);
assert.doesNotMatch(markup,/href="#customer-requote-decision"/);
assert.doesNotMatch(markup,/NaN segundos/);
markup=render('REQUOTE_REQUIRED',{proposedTotalCents:13500});
assert.match(markup,/Atualizar proposta/);
assert.match(markup,/onclick="confirmRequote\(\)" disabled/);
markup=render('REQUOTE_REQUIRED',{proposedTotalCents:13500,
 offerExpiresAt:new Date(Date.now()+90_000).toISOString()});
assert.match(markup,/href="#customer-requote-decision"/);
assert.match(markup,/onclick="confirmRequote\(\)" >/);
markup=render('REQUOTE_REQUIRED',{proposedTotalCents:13500,
 offerExpiresAt:new Date(Date.now()+90_000).toISOString(),
 evidenceTime:new Date(Date.now()-8*60_000).toISOString()});
assert.match(markup,/onclick="confirmRequote\(\)" disabled/);
assert.match(markup,/Atualizar pedido/);
markup=render('REQUOTE_REQUIRED',{proposedTotalCents:13500,
 offerExpiresAt:new Date(Date.now()+90_000).toISOString(),error:'offline'});
assert.match(markup,/onclick="confirmRequote\(\)" disabled/);
assert.match(markup,/Acompanhamento temporariamente sem conexão/);

markup=render('OFFERED_TO_MERCHANT',{offerExpiresAt:'bad-deadline'});
assert.doesNotMatch(markup,/NaN|undefineds restantes/);
assert.match(markup,/Atualize para verificar a resposta/);
assert.match(markup,/A entrega ainda depende de aceite/);
markup=render('REASSIGNING');
assert.match(markup,/Ainda não há nova revenda confirmada/);
assert.doesNotMatch(markup,/Código de recebimento/);
markup=render('CANCELLED',{totalCents:null,itemPrice:null});
assert.match(markup,/Valor do pedido ainda não confirmado/);
assert.match(markup,/Valor não confirmado/);
assert.doesNotMatch(markup,/Total protegido: R\$ 0,00|R\$ NaN/);
assert.match(markup,/O pedido está encerrado/);
markup=render('SETTLED',{totalCents:0,itemPrice:0});
assert.match(markup,/Total protegido: R\$ 0,00/);
assert.match(markup,/Recebimento registrado|Pedido concluído/);
assert.doesNotMatch(source,/adminPerform\(|paymentCapture\(/);
for(const token of ['.customer-requote-proof.needs-refresh',
 '.customer-tracking-order-facts','.customer-requote .order-actions',
 '@media(max-width:650px)','@media(max-width:370px)'])
 assert.ok(css.includes(token),'missing mobile proof hierarchy '+token);
assert.ok(read('.github/workflows/audit.yml').includes('node tests/buyer-tracking-proof-v1-382.mjs'));
console.log('TAMÃO V1.382 PASS — verified deadlines, stale state, no false zero prices, approval blocked without proof, mobile incident clarity.');
