import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const js=read('js/merchant.js');
const css=read('css/components.css');
new vm.Script(js,{filename:'merchant.js'});
const begin=js.indexOf('function merchantLiveOrder(o){');
const finish=js.indexOf('\nasync function merchantEnableAlertsFromUi(){',begin);
assert.ok(begin>=0&&finish>begin,'order card renderer must be located');
const code=js.slice(begin,finish);
const esc=x=>String(x??'').replaceAll('&','&amp;').replaceAll('<','&lt;')
 .replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const ctx=vm.createContext({
 esc,Date,
 globalThis:{merchantRuntime:{merchant:{memberRole:'owner'},actionPending:false}},
 BRL:{format:n=>'R$ '+Number(n).toFixed(2).replace('.',',')},
 statusCopy:{PREPARING:['Em preparação',''],OFFERED_TO_MERCHANT:['Oferecido','']},
 merchantDeliveryCandidates:()=>[],
 merchantDeliveryMemberLabel:()=> '',
 merchantOrderAttentionCard:()=> '',
 merchantSupportForOrder:()=> '',
 merchantIncidentRiskGuide:()=> '',
 merchantOrderProgressView:()=> '',
 merchantDeliveryShortcuts:()=> '',
 merchantScheduledDispatchState:()=>({scheduled:false,ready:true}),
 paymentLabel:()=> 'Dinheiro',formatDeliveryWindow:()=>'',merchantFormatPhone:()=>''
});
vm.runInContext(js.slice(js.indexOf('function merchantOrderBenefitDisclosure('),begin)+'\n'+code+'\nthis.render=merchantLiveOrder;',ctx);
const base={
 status:'PREPARING',orderId:'00000000-0000-4000-8000-000000000390',
 publicCode:'TAM-390',addressVisible:false,paymentMethod:'cash',
 items:[{quantity:1,productName:'Gás P13'}]
};
const render=(extra={})=>ctx.render({...base,...extra});
for(const value of [undefined,null,'',NaN,'invalido',-100,1.25,1000000001,Number.POSITIVE_INFINITY]){
 const html=render({totalCents:value});
 assert.match(html,/Total não confirmado/,'absent or malformed: '+String(value));
 assert.match(html,/merchant-order-total-unverified/);
 assert.doesNotMatch(html,/R\$ 0,00|R\$ NaN|R\$ Infinity/);
}
let html=render({totalCents:0});
assert.match(html,/R\$ 0,00/,'explicit server-returned zero remains zero');
assert.doesNotMatch(html,/Total não confirmado|merchant-order-total-unverified/);
html=render({totalCents:12000});
assert.match(html,/R\$ 120,00/);
assert.doesNotMatch(html,/Total não confirmado/);
for(const tender of [undefined,null,'','NaN',-1,0,1.4,1e12]){
 html=render({totalCents:12000,cashTenderCents:tender});
 assert.doesNotMatch(html,/Troco para:/,'invalid cash tender must not render: '+String(tender));
}
html=render({totalCents:12000,cashTenderCents:25000});
assert.match(html,/Troco para: R\$ 250,00/);
html=render({totalCents:null,cashTenderCents:25000});
assert.match(html,/Total não confirmado/);
assert.match(html,/Troco para: R\$ 250,00/,'valid explicit tender is not a verified total');
html=render({totalCents:null,cashTenderCents:25000,paymentMethod:'pix'});
assert.doesNotMatch(html,/Troco para:/,'non-cash payment cannot present change');

const pre=js.slice(js.indexOf('function merchantUnifiedOpsModel('),begin);
assert.match(pre,/merchantUnifiedOpsBoard/,'three-lane work dashboard retained');
assert.doesNotMatch(code,/adminSetSupportStatus\(|supabase\.from\(|fetch\(/);
assert.ok(css.includes('.merchant-order-total .merchant-order-total-unverified'));
assert.ok(css.includes('@media(max-width:420px)'));
assert.ok(read('.github/workflows/audit.yml').includes('node tests/merchant-verified-amount-v1-390.mjs'));
console.log('TAMÃO V1.390 PASS — absent/invalid order totals never become R$ 0,00, explicit zero remains, cash tender validated without changing order actions.');
