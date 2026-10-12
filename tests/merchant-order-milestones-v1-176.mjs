import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const load=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const src=load('js/merchant.js'),css=load('css/components.css'),backend=load('js/backend.js');
new vm.Script(src,{filename:'js/merchant.js'});
const pick=name=>{
 const start=src.indexOf('function '+name+'(');
 assert.ok(start>=0,'missing '+name);
 const end=src.indexOf('\n}',start);
 assert.ok(end>start,'missing closing brace '+name);
 return src.slice(start,end+2);
};
const esc=x=>String(x??'').replaceAll('&','&amp;').replaceAll('<','&lt;')
 .replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const date=minutesAgo=>new Date(Date.now()-minutesAgo*60000).toISOString();
const context=vm.createContext({esc});
vm.runInContext([pick('merchantOrderEventDate'),pick('merchantOrderProgressView')]
 .join('\n')+';this.timeline=merchantOrderProgressView;this.event=merchantOrderEventDate;',context);
const order={
 status:'ARRIVING',
 createdAt:date(80),acceptedAt:date(72),dispatchedAt:date(38),arrivingAt:date(5),
 dispatchDueAt:date(50),promisedBy:date(-25)
};
let markup=context.timeline(order);
for(const label of ['Pedido registrado','Aceite da revenda','Saída para entrega','Chegada informada','Entrega concluída'])
 assert.ok(markup.includes(label),label);
assert.ok(markup.includes('Chegada informada</small>')||markup.includes('Chegada informada'),
 'Current stage caption available');
assert.equal(markup.split('Confirmado em ').length-1,4,'Only four events have server-provided valid times');
assert.ok(markup.includes('Aguardando confirmação'),'Delivery is not yet concluded');
assert.ok(markup.includes('Previsão de entrega registrada'));
assert.ok(markup.includes('Previsões não são confirmações de entrega.'));
assert.ok(!markup.includes('Entrega concluída</strong><small>Confirmado em'),'Must never claim delivery happened without proof');
assert.ok(!markup.includes('<script'));
assert.ok(context.event(date(-60))===null,'Future event rejected');
assert.ok(context.event('yesterday')===null,'Non-ISO event rejected');
assert.ok(context.event('2024-13-99T00:00:00Z')===null,'Invalid calendar event rejected');
assert.ok(context.event(null)===null,'Null event rejected');

markup=context.timeline({
 status:'OFFERED_TO_MERCHANT',
 createdAt:date(10),acceptedAt:date(9),
 dispatchedAt:date(8),arrivingAt:date(7),promisedBy:'bad-date'
});
assert.equal(markup.split('Confirmado em ').length-1,1,
 'Even if timestamps exist, steps beyond current status cannot be called confirmed');
assert.ok(markup.includes('Aguardando aceite da revenda'));
assert.ok(!markup.includes('Previsão de entrega registrada'));

markup=context.timeline({status:'AT_RISK',createdAt:date(120),acceptedAt:null});
assert.ok(markup.includes('class="merchant-order-progress" open'),'Risk status automatically expands timeline');
assert.ok(markup.includes('Atenção operacional necessária'));
assert.ok(markup.includes('Etapa atual informada pelo sistema'));
assert.ok(markup.includes('sem horário neste registro'));

markup=context.timeline({status:'UNKNOWN_STATUS',createdAt:date(15)});
assert.ok(!markup.includes('Confirmado em '),'Unknown statuses cannot fabricate verified sequence');
assert.ok(markup.includes('Status em atualização'));

const rt={merchant:{memberRole:'operator'},actionPending:false,deliveryTeam:[],orders:[]};
const cardCtx=vm.createContext({
 globalThis:{merchantRuntime:rt},esc,
 BRL:{format:value=>'R$ '+Number(value).toFixed(2)},statusCopy:{},
 paymentLabel:()=> 'Pix',merchantScheduledDispatchState:()=>({scheduled:false,ready:true}),
 merchantDeliveryMemberLabel:()=> 'Responsável',merchantFormatPhone:s=>String(s)
});
vm.runInContext([
 pick('merchantDeliveryCandidates'),
 pick('merchantOrderEventDate'),
 pick('merchantOrderProgressView'),
 pick('merchantLiveOrder')
].join('\n')+';this.card=merchantLiveOrder;',cardCtx);
const item={
 orderId:'11111111-1111-4111-8111-111111111111',publicCode:'TAM-101',
 totalCents:11990,paymentMethod:'pix',items:[{quantity:1,productName:'Gás P13'}],
 addressVisible:false,deliveryDetailsVisible:false,createdAt:date(10),
 status:'MERCHANT_ACCEPTED'
};
markup=cardCtx.card(item);
assert.ok(markup.includes('Acompanhar etapas'));
assert.ok(markup.includes('Pedido aceito. A preparação será atualizada pelo sistema'));
assert.ok(!markup.includes('Confirmar saída'),'Cannot dispatch before PREPARING, server rejects this state');
item.status='PREPARING';
markup=cardCtx.card(item);
assert.ok(markup.includes('Confirmar saída'));
assert.ok(markup.includes('Não consigo concluir este pedido'),'Failure escape hatch preserved');
item.status='ARRIVING';
markup=cardCtx.card(item);
assert.ok(markup.includes('live-pin-')&&markup.includes('Pagamento recebido'));
assert.ok(markup.includes('Confirmar entrega'));
assert.ok(!markup.includes('Telefone não informado'),'No unauthorized personal contact details');
item.status='OUT_FOR_DELIVERY';
markup=cardCtx.card(item);
assert.ok(markup.includes('Estou chegando'));
assert.ok(markup.indexOf('Acompanhar etapas')<markup.indexOf('Pagamento:'),'Progress easy to find');
assert.ok(backend.includes('expectedVersion:order.version'),'Version-checked server actions preserved');
assert.ok(backend.includes('merchantRuntime.actionPending=true'),'Action concurrency gate preserved');
assert.ok(css.includes('.merchant-order-milestones'));
assert.ok(css.includes('.merchant-order-progress>summary'));
assert.ok(css.includes('@media(max-width:540px)'));
assert.ok(load('.github/workflows/audit.yml').includes('node tests/merchant-order-milestones-v1-176.mjs'));
console.log('V1.176: recorded-only timestamps, ETA disclaimer, stage accuracy, risk visibility, privacy and action safety passed.');
