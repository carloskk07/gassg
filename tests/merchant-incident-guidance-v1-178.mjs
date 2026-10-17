import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const src=read('js/merchant.js');
const css=read('css/components.css');
const backend=read('js/backend.js');
new vm.Script(src,{filename:'js/merchant.js'});
const extract=name=>{
 const start=src.indexOf('function '+name+'(');
 assert.ok(start>=0,'missing function '+name);
 const end=src.indexOf('\n}',start);
 assert.ok(end>start,'closing brace '+name);
 return src.slice(start,end+2);
};
const esc=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;')
 .replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const id='11111111-1111-4111-8111-111111111111';
const rt={merchant:{memberRole:'owner'},deliveryTeam:[],actionPending:false,
 orders:[{orderId:id,status:'PREPARING',version:2}]};
const adviceCtx=vm.createContext({esc});
vm.runInContext(extract('merchantIncidentAdvice')+'\n'+extract('merchantIncidentRiskGuide')+
 ';this.advice=merchantIncidentAdvice;this.risk=merchantIncidentRiskGuide;',adviceCtx);
const choiceTexts={
 stock_issue:'estoque físico',
 vehicle_issue:'transporte adequado',
 staffing_issue:'Consulte quem pode realizar',
 other_operational:'Confira os dados'
};
for(const [code,phrase] of Object.entries(choiceTexts)){
 const advice=adviceCtx.advice(code);
 assert.ok(advice&&advice.guidance.includes(phrase),'relevant advice for '+code);
 assert.ok(advice.next.length>10);
 assert.ok(!/garantid[oa]|já foi redirecionado/i.test(advice.guidance),'No unverified fulfillment guarantee');
}
for(const unlisted of ['',null,'<img src=x onerror=alert(1)>','stock_issue ']){
 assert.equal(adviceCtx.advice(unlisted),null,'Unexpected code cannot appear authorized');
}
assert.equal(adviceCtx.risk({status:'PREPARING',riskReason:'stock_issue'}),'');
assert.ok(adviceCtx.risk({status:'AT_RISK',riskReason:'stock_issue'}).includes('estoque físico'));
assert.ok(adviceCtx.risk({status:'AT_RISK',riskReason:'unrecognized-value'}).includes('Confira o problema'));
assert.ok(!adviceCtx.risk({status:'AT_RISK',riskReason:'unrecognized-value'}).includes('estoque físico'));

const fields={
 ['reason-'+id]:{value:''},
 ['merchant-incident-guide-'+id]:{textContent:''},
 ['merchant-incident-confirm-'+id]:{checked:false},
 ['merchant-incident-submit-'+id]:{disabled:true}
};
const dom=vm.createContext({document:{getElementById:key=>fields[key]||null}});
vm.runInContext([extract('merchantIncidentAdvice'),extract('merchantIncidentAcknowledged'),
 extract('merchantIncidentChoiceChanged')].join('\n')+
 ';this.reasonChanged=merchantIncidentChoiceChanged;this.ack=merchantIncidentAcknowledged;',dom);
fields['reason-'+id].value='vehicle_issue';
dom.reasonChanged(id);
assert.ok(fields['merchant-incident-guide-'+id].textContent.includes('transporte adequado'));
assert.equal(fields['merchant-incident-submit-'+id].disabled,true,'No confirmation by default');
fields['merchant-incident-confirm-'+id].checked=true;
dom.ack(id);
assert.equal(fields['merchant-incident-submit-'+id].disabled,false,'Valid code and explicit consent required');
fields['reason-'+id].value='staffing_issue';
dom.reasonChanged(id);
assert.equal(fields['merchant-incident-confirm-'+id].checked,false,'Changing reason revokes prior confirmation');
assert.equal(fields['merchant-incident-submit-'+id].disabled,true);
assert.ok(fields['merchant-incident-guide-'+id].textContent.includes('Consulte quem pode'));
fields['reason-'+id].value='untrusted_reason';
fields['merchant-incident-confirm-'+id].checked=true;
dom.ack(id);
assert.equal(fields['merchant-incident-submit-'+id].disabled,true,'Unknown reason never enables action');
fields['reason-'+id].value='';
dom.reasonChanged(id);
assert.ok(fields['merchant-incident-guide-'+id].textContent.includes('Selecione o motivo'));
assert.equal(fields['merchant-incident-submit-'+id].disabled,true);

const cardCtx=vm.createContext({globalThis:{merchantRuntime:rt},esc,
 BRL:{format:v=>'R$ '+Number(v).toFixed(2)},statusCopy:{},paymentLabel:()=> 'Pix',
 merchantScheduledDispatchState:()=>({scheduled:false,ready:true}),
 merchantDeliveryMemberLabel:()=> '',merchantFormatPhone:v=>String(v),merchantDeliveryShortcuts:()=>''});
vm.runInContext(['merchantDeliveryCandidates','merchantOrderEventDate','merchantOrderScheduleDate',
 'merchantOrderProgressView','merchantOrderAttention','merchantOrderAttentionCard',
 'merchantIncidentAdvice','merchantIncidentRiskGuide','merchantLiveOrder']
 .map(extract).join('\n')+';this.card=merchantLiveOrder;',cardCtx);
const o={orderId:id,status:'PREPARING',items:[],totalCents:12000,
 paymentMethod:'pix',addressVisible:false,deliveryDetailsVisible:false,version:2};
let html=cardCtx.card(o);
for(const text of ['Selecione o motivo','O que aconteceu?','Problema com o veículo',
 'Equipe indisponível','Outro problema operacional','Registrar impossibilidade',
 'Confirmo que não conseguirei cumprir este pedido','Isso não garante outra revenda disponível']){
 assert.ok(html.includes(text),'Required safe copy: '+text);
}
assert.ok(html.includes('id="merchant-incident-submit-'+id+'" class="danger-btn small" disabled'));
assert.ok(html.includes("merchantIncidentChoiceChanged('"+id+"')"));
assert.ok(html.includes("merchantIncidentAcknowledged('"+id+"')"));
assert.ok(html.includes('Confirmar saída'),'Allowed PREPARING dispatch is preserved');
assert.ok(!html.includes('<script'));
o.status='AT_RISK';
o.riskReason='stock_issue';
html=cardCtx.card(o);
assert.ok(html.includes('Como proceder com este imprevisto'));
assert.ok(html.includes('estoque físico'));
assert.ok(html.includes('merchant-incident-guide'));
o.riskReason='<img src=x onerror=alert(1)>';
html=cardCtx.card(o);
assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
assert.ok(!html.includes('<img src=x onerror=alert(1)>'),'Server reason escaped');
o.status='OUT_FOR_DELIVERY';
html=cardCtx.card(o);
assert.ok(!html.includes('merchant-incident-submit'),'Cannot report this outcome after dispatch from UI');
assert.ok(html.includes('Estou chegando'));
o.status='ARRIVING';
html=cardCtx.card(o);
assert.ok(html.includes('live-pin-')&&html.includes('Pagamento recebido'));

const messages=[];
let calls=0;
let reject=false;
const actionCtx=vm.createContext({
 globalThis:{merchantRuntime:rt},
 document:{getElementById:k=>fields[k]||null},
 toast:v=>messages.push(String(v)),
 merchantPerformAction:async(...args)=>{calls++;if(reject)throw new Error('VERSION_CONFLICT');return args}
});
vm.runInContext(extract('merchantIncidentAdvice')+'\n'+extract('merchantPostActionConfirmation')+'\nasync '+
 extract('merchantLiveCannotFulfill')+
 ';this.failOrder=merchantLiveCannotFulfill;',actionCtx);
const act=actionCtx.failOrder;
rt.orders[0].status='PREPARING';
fields['reason-'+id].value='';
fields['merchant-incident-confirm-'+id].checked=false;
await act(id);
assert.equal(calls,0,'Unknown reason rejected');
assert.ok(messages.at(-1).includes('Selecione o motivo'));
fields['reason-'+id].value='stock_issue';
await act(id);
assert.equal(calls,0,'Missing explicit confirmation rejected');
fields['merchant-incident-confirm-'+id].checked=true;
rt.actionPending=true;
await act(id);
assert.equal(calls,0,'Concurrent action blocked');
rt.actionPending=false;
rt.orders[0].status='OUT_FOR_DELIVERY';
await act(id);
assert.equal(calls,0,'No failure report after dispatch');
rt.orders[0].status='PREPARING';
fields['reason-'+id].value='untrusted_reason';
await act(id);
assert.equal(calls,0,'Unknown reason not sent');
fields['reason-'+id].value='vehicle_issue';
await act(id);
assert.equal(calls,1,'Once after deliberate confirmation');
assert.ok(messages.at(-1).includes('Impossibilidade registrada.'));
assert.ok(!messages.at(-1).includes('estoque recomposto'),'No claim without specific backend evidence');
reject=true;
await act(id);
assert.equal(calls,2);
assert.ok(messages.at(-1).includes('VERSION_CONFLICT'),'Backend conflict remains visible');
assert.ok(backend.includes('expectedVersion:order.version'),'Backend version check unchanged');
assert.ok(backend.includes("merchantRuntime.actionPending=true;"),'Backend concurrency protection unchanged');
assert.ok(css.includes('.merchant-incident-guide')&&css.includes('.merchant-incident-ack'));
assert.ok(css.includes('@media(max-width:540px)'));
assert.ok(read('.github/workflows/audit.yml').includes('node tests/merchant-incident-guidance-v1-178.mjs'));
console.log('V1.178: precise incident guidance, status restrictions, confirmation, XSS, failure messages and backend authority passed.');
