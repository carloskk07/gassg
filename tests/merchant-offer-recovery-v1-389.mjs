import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const js=read('js/merchant.js'),css=read('css/components.css');
new vm.Script(js,{filename:'merchant.js'});
const cut=name=>{
 const a=js.indexOf('function '+name+'('),b=js.indexOf('\n}',a);
 assert.ok(a>=0&&b>a,'missing '+name);
 return js.slice(a,b+2);
};
const esc=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;')
 .replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const date=n=>new Date(Date.now()+n*60000).toISOString();
const offer=(n,deadline)=>({orderId:id(n),publicCode:'TAM-'+n,
 status:'OFFERED_TO_MERCHANT',offerExpiresAt:deadline});
const rt={status:'ready',actionPending:false,
 merchant:{memberRole:'owner',merchantId:id(30)},
 selectedMerchantId:id(30),lastSyncAt:new Date().toISOString(),
 supportSummary:{version:1,scope:'merchant-active-orders'},
 orders:[]};
const a=js.indexOf('const MERCHANT_SUPPORT_LABELS=');
const b=js.indexOf('function merchantLiveOrder(o){',a);
assert.ok(a>=0&&b>a);
const context=vm.createContext({
 globalThis:{merchantRuntime:rt},esc,Date,
 merchantOrderScheduleDate:raw=>raw&&Number.isFinite(Date.parse(raw))?new Date(raw):null
});
vm.runInContext([cut('merchantOrderListEvidence'),cut('merchantDeliveryBoardModel'),
 js.slice(a,b),'this.model=merchantUnifiedOpsModel;this.board=merchantUnifiedOpsBoard;'].join('\n'),context);
const onlyOfferCard=html=>html.match(/<article class="merchant-unified-lane merchant-unified-offers">[\s\S]*?<\/article>/)?.[0]||'';
let list=[offer(1,date(-15)),offer(2,null),offer(3,'2026-99-99T13:00:00Z')];
rt.orders=list;
let model=context.model(rt,list);
assert.equal(model.offers.count,3);
assert.equal(model.offers.valid,0);
assert.equal(model.offers.unverified,3);
assert.equal(model.offers.first,null);
let card=onlyOfferCard(context.board(rt,list));
assert.match(card,/3 ofertas sem prazo válido para aceite/);
assert.match(card,/0 com prazo confirmado nesta consulta/);
assert.match(card,/Atualizar ofertas para decidir/);
assert.match(card,/onclick="merchantLiveRefresh\(\)"/);
assert.doesNotMatch(card,/Sem ação nesta categoria agora/);
assert.doesNotMatch(card,/merchantUnifiedFocusOrder\(/);
assert.doesNotMatch(card,/merchantLiveAction\(|merchantLiveDeliver\(|merchantPerformAction\(/);

const valid=offer(4,date(7));
list=[offer(1,date(-15)),valid,offer(2,null)];
rt.orders=list;
model=context.model(rt,list);
assert.equal(model.offers.count,3);
assert.equal(model.offers.valid,1);
card=onlyOfferCard(context.board(rt,list));
assert.match(card,/Ver pedido para aceitar/);
assert.match(card,/merchantUnifiedFocusOrder\('00000000-0000-4000-8000-000000000004','offers'\)/);
assert.match(card,/Atualizar outras ofertas/);
assert.match(card,/class="merchant-unified-recovery" onclick="merchantLiveRefresh\(\)"/);
assert.ok(card.indexOf('Ver pedido para aceitar')<card.indexOf('Atualizar outras ofertas'));
assert.doesNotMatch(card,/onclick="merchantLiveAction/);

rt.actionPending=true;
card=onlyOfferCard(context.board(rt,list));
assert.match(card,/class="merchant-unified-recovery" onclick="merchantLiveRefresh\(\)" disabled/);
rt.actionPending=false;
list=[offer(4,date(5)),offer(5,date(9))];
rt.orders=list;
card=onlyOfferCard(context.board(rt,list));
assert.match(card,/Ver pedido para aceitar/);
assert.doesNotMatch(card,/Atualizar outras ofertas|Atualizar ofertas para decidir/);
assert.doesNotMatch(card,/merchant-unified-recovery/);
list=[];
rt.orders=list;
card=onlyOfferCard(context.board(rt,list));
assert.match(card,/Nenhum novo pedido informado/);
assert.match(card,/Sem ação nesta categoria agora/);
assert.doesNotMatch(card,/Atualizar ofertas para decidir/);

list=[offer(6,date(-2))];rt.orders=list;
rt.lastSyncAt=date(-4);
assert.equal(context.board(rt,list),'','never suggest action based on stale snapshot');
rt.lastSyncAt=date(0);
rt.selectedMerchantId=id(34);
assert.equal(context.board(rt,list),'','no cross-merchant action');
rt.selectedMerchantId=id(30);
rt.status='error';
assert.equal(context.board(rt,list),'','failed refresh cannot show recovery controls');
rt.status='ready';
for(const role of ['driver','not-authorized']){
 rt.merchant.memberRole=role;
 assert.equal(context.board(rt,list),'');
}
rt.merchant.memberRole='owner';
assert.match(onlyOfferCard(context.board(rt,list)),/Atualizar ofertas para decidir/);
const block=js.slice(js.indexOf('function merchantUnifiedOpsBoard('),
 js.indexOf('function merchantLiveOrder(o){'));
assert.doesNotMatch(block,/fetch\(|supabase\.from\(|merchantPerformAction\(|adminSetSupportStatus\(/);
assert.ok(css.includes('.merchant-unified-recovery'));
assert.ok(css.includes('.merchant-unified-recovery:disabled'));
assert.ok(css.includes('.merchant-unified-recovery:focus-visible'));
assert.ok(css.includes('@media(max-width:480px)'));
assert.ok(read('.github/workflows/audit.yml').includes('node tests/merchant-offer-recovery-v1-389.mjs'));
console.log('TAMÃO V1.389 PASS — invalid offer deadlines trigger refresh, valid offers retain safe focus, no stale/cross-merchant shortcuts or implicit acceptance.');
