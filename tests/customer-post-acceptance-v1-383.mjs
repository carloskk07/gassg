import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const customer=read('js/customer.js'),css=read('css/components.css');
new vm.Script(customer,{filename:'customer.js'});
const begin=customer.indexOf('const statusCopy={');
const end=customer.indexOf('\nfunction tracking(){',begin);
assert.ok(begin>0&&end>begin);
const source=customer.slice(begin,end);
const esc=x=>String(x??'').replaceAll('&','&amp;').replaceAll('<','&lt;')
 .replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const runtime={status:'ready',orderId:'order-383',error:null,actionPending:false,order:null,
 orderCheckedId:'order-383',orderCheckedAt:new Date().toISOString()};
const ctx=vm.createContext({
 globalThis:{liveReady:()=>true,liveRuntime:runtime},
 liveRuntime:runtime,shell:x=>x,esc,
 BRL:{format:n=>'R$ '+Number(n).toFixed(2).replace('.',',')},
 formatDeliveryWindow:()=> 'Entre 15h e 17h',
 formatDeliveryPhone:()=> '***',paymentLabel:()=> 'Pix',hhmm:()=> '14:00',
});
vm.runInContext(source,ctx);
const run=s=>vm.runInContext(s,ctx);
const render=(status,{pin=null,age=0,error=null,extras={}}={})=>{
 runtime.error=error;
 runtime.actionPending=false;
 runtime.orderCheckedId='order-383';
 runtime.orderCheckedAt=new Date(Date.now()-age*60000).toISOString();
 runtime.order={status,orderId:'order-383',publicCode:'TAM-383',totalCents:12400,
  paymentMethod:'pix',supplierName:'Revenda Confirmada',postalCode:'97300000',
  address:'Rua Teste 10',deliveryPin:pin,items:[{quantity:1,productName:'Água 20 L',lineTotalCents:12400}],
  events:[],supportCases:[],...extras};
 return run('liveTracking()');
};
const card=html=>html.match(/<section class="customer-delivery-guide [\s\S]*?<\/section>/)?.[0]||'';
const scenarios=[
 ['MERCHANT_ACCEPTED','Revenda aceitou o pedido','A preparação e a saída ainda dependem'],
 ['PREPARING','Pedido em preparação','A saída para entrega ainda não foi confirmada'],
 ['OUT_FOR_DELIVERY','Saída para entrega informada','recebimento ainda não foram confirmados'],
 ['ARRIVING','Chegada informada','o recebimento ainda não está confirmado'],
 ['DELIVERED','Recebimento registrado','conciliação financeira pode ainda estar em processamento'],
 ['SETTLED','Pedido concluído','conciliação constam como registrados']
];
for(const [status,heading,detail] of scenarios){
 const html=render(status);
 const guidance=card(html);
 assert.ok(guidance.includes(heading),'missing known stage '+status);
 assert.ok(guidance.includes(detail),'missing truthful detail '+status);
 assert.ok(guidance.includes('ÚLTIMA ETAPA CONSULTADA'));
 assert.ok(guidance.includes('Preciso de ajuda'));
 assert.ok(html.includes('id="customer-care"'));
 assert.ok(html.includes('O que fazer agora'));
 assert.ok(!/entrega garantida|chegará em \d+ min|GPS em tempo real|entrega concluída automaticamente/i.test(guidance));
 assert.ok(!guidance.includes('Código de recebimento:'));
}
assert.match(render('MERCHANT_ACCEPTED'),/REVENDA ACEITOU/);
assert.match(render('PREPARING'),/EM PREPARAÇÃO/);
assert.match(render('OUT_FOR_DELIVERY'),/SAÍDA INFORMADA/);
assert.match(render('ARRIVING'),/CHEGADA INFORMADA/);
assert.match(render('DELIVERED'),/ENTREGA REGISTRADA/);
assert.match(render('SETTLED'),/CONCLUÍDO/);
const dispatched=render('OUT_FOR_DELIVERY',{pin:'7631'});
assert.match(card(dispatched),/Ver orientações de recebimento/);
assert.match(dispatched,/id="customer-delivery-code"/);
assert.match(dispatched,/Código de recebimento: 7631/);
assert.match(dispatched,/Só compartilhe o código após receber e conferir a entrega/);
for(const status of ['CREATED','QUOTE_LOCKED','OFFERED_TO_MERCHANT','REASSIGNING',
 'REQUOTE_REQUIRED','AT_RISK','CANCELLED']){
 const html=render(status,{pin:'7631'});
 assert.equal(card(html),'','stage card must not claim delivery for '+status);
 assert.doesNotMatch(html,/Código de recebimento: 7631/);
}
assert.equal(card(render('OUT_FOR_DELIVERY',{pin:null})).includes('href="#customer-delivery-code"'),false,
 'do not jump to absent delivery instructions');
assert.equal(card(render('ARRIVING',{pin:null})).includes('href="#customer-delivery-code"'),false);
for(const status of ['MERCHANT_ACCEPTED','PREPARING','OUT_FOR_DELIVERY','ARRIVING','DELIVERED','SETTLED']){
 const markup=render(status,{age:11,pin:status==='OUT_FOR_DELIVERY'?'7631':null});
 const guide=card(markup);
 assert.match(guide,/Última etapa registrada:/);
 assert.match(guide,/ATUALIZAÇÃO NECESSÁRIA/);
 assert.match(guide,/Atualizar pedido/);
 assert.doesNotMatch(guide,/Ver orientações de recebimento|ÚLTIMA ETAPA CONSULTADA/);
 assert.match(guide,/O estado pode ter mudado desde a última consulta/);
 if(status!=='SETTLED')assert.match(markup,/ATUALIZE O STATUS/);
}
const stale=render('OUT_FOR_DELIVERY',{age:11,pin:'7631'});
assert.match(stale,/ATUALIZE O STATUS/);
assert.match(stale,/Última consulta deste pedido há 11 min/);
const offline=render('ARRIVING',{error:'connection_lost',pin:'7631'});
assert.match(offline,/VERIFIQUE O STATUS/);
assert.doesNotMatch(offline,/status-pill online/);
assert.match(card(offline),/Atualizar pedido/);
assert.match(offline,/Acompanhamento temporariamente sem conexão/);
const expired=render('CANCELLED');
assert.match(expired,/ENCERRADO/);
assert.equal(card(expired),'');
const risky=render('AT_RISK');
assert.match(risky,/PRECISA DE ATENÇÃO/);
assert.equal(card(risky),'');
const unsafe=run('customerDeliveryStagePanel({status:"__proto__",deliveryPin:"PIN"}, {evidence:{kind:"recent"}})');
assert.equal(unsafe,'');
for(const rule of ['.customer-delivery-guide.needs-update',
 '.customer-delivery-guide-actions','.customer-delivery-guide-help',
 '@media(max-width:620px)','@media(max-width:370px)',
 '@media(prefers-reduced-motion:reduce)']){
 assert.ok(css.includes(rule),'missing mobile/accessibility rule '+rule);
}
assert.ok(!/liveCreateOrder\(|liveSubmitDelivery|confirmRequote\(/.test(
 customer.slice(customer.indexOf('function customerDeliveryStagePanel('),
 customer.indexOf('function customerTrackingStatusPresentation('))),
 'stage guide may not perform order or financial actions');
assert.ok(read('.github/workflows/audit.yml').includes('node tests/customer-post-acceptance-v1-383.mjs'));
console.log('TAMÃO V1.383 PASS — stage-specific guidance, stale/offline status, no premature receipt, protected PIN, mobile help and no business-state mutation.');
