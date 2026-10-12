import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const ui=read('js/merchant.js'),css=read('css/components.css'),backend=read('js/backend.js');
new vm.Script(ui,{filename:'js/merchant.js'});
const take=name=>{
 const start=ui.indexOf('function '+name+'(');
 assert.ok(start>=0,'function '+name);
 const end=ui.indexOf('\n}',start);
 assert.ok(end>start,name+' closure');
 return ui.slice(start,end+2);
};
const takeAsync=name=>take(name).replace('function '+name+'(','async function '+name+'(');
const esc=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;')
 .replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const a='11111111-1111-4111-8111-111111111111';
const b='22222222-2222-4222-8222-222222222222';
const c='33333333-3333-4333-8333-333333333333';
const d='44444444-4444-4444-8444-444444444444';
const order1='55555555-5555-4555-8555-555555555555';
const order2='66666666-6666-4666-8666-666666666666';
const rt={
 merchant:{memberRole:'owner'},
 actionPending:false,
 deliveryTeam:[
  {userId:a,memberRole:'operator',displayName:'Ana'},
  {userId:b,memberRole:'driver',displayName:'Beatriz'},
  {userId:c,memberRole:'driver',displayName:'Carla'},
  {userId:d,memberRole:'owner',displayName:'Dono'},
  {userId:'not-a-uuid',memberRole:'driver',displayName:'Injetado'},
  {userId:'77777777-7777-4777-8777-777777777777',memberRole:'visitor',displayName:'Visitante'}
 ],
 orders:[
  {orderId:order1,status:'PREPARING',publicCode:'TAM-1',assignedDeliveryUserId:null},
  {orderId:order2,status:'AT_RISK',publicCode:'TAM-2',assignedDeliveryUserId:null},
  {orderId:'other1',status:'OUT_FOR_DELIVERY',assignedDeliveryUserId:b},
  {orderId:'other2',status:'ARRIVING',assignedDeliveryUserId:b},
  {orderId:'other3',status:'PREPARING',assignedDeliveryUserId:c},
  {orderId:'done',status:'DELIVERED',assignedDeliveryUserId:c}
 ]
};
const ctx=vm.createContext({
 globalThis:{merchantRuntime:rt},esc,
 BRL:{format:n=>'R$ '+Number(n).toFixed(2)},
 statusCopy:{},paymentLabel:()=> 'Pix',
 merchantScheduledDispatchState:()=>({scheduled:false,ready:true}),
 merchantDeliveryMemberLabel:()=> 'Responsável',
 merchantFormatPhone:v=>String(v)
});
vm.runInContext(['merchantDeliveryCandidates','merchantDeliveryUnassigned','merchantDeliveryAttentionView','merchantLiveOrder']
 .map(take).join('\n')+';this.candidates=merchantDeliveryCandidates;this.unassigned=merchantDeliveryUnassigned;this.attention=merchantDeliveryAttentionView;this.card=merchantLiveOrder;',ctx);
const candidates=ctx.candidates(rt);
assert.equal(candidates.length,4,'Only eligible active member roles with valid IDs');
assert.equal(candidates[0].userId,c,'Drivers with fewer active orders should appear first');
assert.equal(candidates[0].assignedCount,1,'Completed delivery excluded from workload');
assert.equal(candidates[1].userId,b,'Driver with two active orders second');
assert.equal(candidates[1].assignedCount,2);
assert.equal(candidates[2].userId,a,'Other eligible team members remain selectable');
assert.equal(ctx.unassigned(rt.orders).length,2);
const reminder=ctx.attention(rt);
assert.ok(reminder.includes('2 pedidos precisam de responsável'));
assert.ok(reminder.includes('TAM-1')&&reminder.includes('TAM-2'));
assert.ok(reminder.includes("merchantFocusDeliveryAssignment('"+order1+"')"));
assert.ok(!reminder.includes('Visitante'));
let card=ctx.card({...rt.orders[0],paymentMethod:'pix',totalCents:12000,items:[]});
assert.ok(card.includes('Entrega sem responsável'));
assert.ok(card.includes('Quem fará a entrega?'));
assert.ok(card.includes('Confirmar responsável'));
assert.ok(card.includes('A atribuição só será confirmada depois de salvar.'));
assert.ok(card.includes('1 pedido ativo')&&card.includes('2 pedidos ativos'));
assert.ok(card.includes('não indicam disponibilidade'));
assert.ok(!card.includes('Injetado')&&!card.includes('Visitante'));
assert.ok(card.includes('merchantLiveAssignDelivery('));
assert.ok(card.includes('merchantDeliveryAssignmentChanged('));
const assigned={...rt.orders[0],assignedDeliveryUserId:b};
card=ctx.card(assigned);
assert.ok(card.includes('Responsável definido'));
assert.ok(card.includes('Alterar responsável'));
assert.ok(card.includes('Salvar alteração'));
assert.ok(card.includes('value="'+b+'" selected'));
rt.merchant.memberRole='operator';
card=ctx.card({...rt.orders[0],items:[],totalCents:1000});
assert.ok(!card.includes('merchant-delivery-assignment'));
assert.equal(ctx.attention(rt),'','Operator cannot see assignment summary');
rt.merchant.memberRole='driver';
assert.equal(ctx.attention(rt),'','Driver cannot see other worker assignment queue');
rt.merchant.memberRole='owner';
rt.actionPending=true;
assert.ok(ctx.card({...rt.orders[0],items:[],totalCents:1000}).includes('merchant-delivery-assign-form form-stack" disabled'));
rt.actionPending=false;
const backup=rt.deliveryTeam;rt.deliveryTeam=[];
card=ctx.card({...rt.orders[0],items:[],totalCents:1000});
assert.ok(card.includes('Gerenciar equipe'),'Empty roster offers actionable path');
assert.ok(ctx.attention(rt).includes('Adicionar alguém à equipe'),'No selectable team offers a team setup path');
assert.ok(!ctx.attention(rt).includes('merchantFocusDeliveryAssignment('),'No useless shortcut when team is empty');
rt.deliveryTeam=backup;
const focusDoc={
 parentElement:null,
 focused:false,
 scrollIntoView(){this.scrolled=true},
 focus(){this.focused=true}
};
const nested={tagName:'DETAILS',open:false,parentElement:null};focusDoc.parentElement=nested;
const docs={getElementById:id=>id==='delivery-'+order1?focusDoc:null};
const focusCtx=vm.createContext({document:docs});
vm.runInContext(take('merchantFocusDeliveryAssignment')+';this.focusAssign=merchantFocusDeliveryAssignment;',focusCtx);
assert.equal(focusCtx.focusAssign(order1),true);
assert.equal(nested.open,true);
assert.equal(focusDoc.focused,true);
assert.equal(focusCtx.focusAssign('invalid-id'),false);
let called=0;
const btn={disabled:false,textContent:'Confirmar responsável'};
const selected={value:b};
const elements={['delivery-'+order1]:selected,['delivery-save-'+order1]:btn};
const messages=[];
const actionCtx=vm.createContext({
 globalThis:{merchantRuntime:rt},
 document:{getElementById:id=>elements[id]||null},
 toast:x=>messages.push(String(x)),
 merchantAssignDeliveryLive:async()=>{called++;return {}}
});
vm.runInContext(take('merchantDeliveryCandidates')+'\n'+
 'async '+take('merchantLiveAssignDelivery')+';this.assign=merchantLiveAssignDelivery;',actionCtx);
rt.actionPending=true;await actionCtx.assign(order1);
assert.equal(called,0,'No assignment when request already pending');
rt.actionPending=false;
rt.merchant.memberRole='operator';
await actionCtx.assign(order1);
assert.equal(called,0,'Operator cannot reassign from UI');
rt.merchant.memberRole='owner';
selected.value='99999999-9999-4999-8999-999999999999';
await actionCtx.assign(order1);
assert.equal(called,0,'Member must be in current active deliveryTeam');
selected.value=b;
await actionCtx.assign(order1);
assert.equal(called,1);
assert.ok(messages.includes('Responsável pela entrega confirmado'));
rt.orders[0].assignedDeliveryUserId=b;
await actionCtx.assign(order1);
assert.equal(called,1,'Same assignment is no-op');
rt.orders[0].assignedDeliveryUserId=null;
assert.equal(btn.disabled,false,'Button restored after request');
const changed={textContent:''};
elements['delivery-feedback-'+order1]=changed;
vm.runInContext(take('merchantDeliveryAssignmentChanged')+';this.markChange=merchantDeliveryAssignmentChanged;',actionCtx);
actionCtx.markChange(order1);
assert.ok(changed.textContent.includes('ainda não salva'));
assert.ok(backend.includes("action:'assign-delivery'")&&backend.includes('expectedVersion:order.version'),'Backend still authorizes versioned assignment');
assert.ok(css.includes('.merchant-delivery-reminders')&&css.includes('@media(max-width:540px)'));
console.log('V1.175: assignment suggestion, access control, workload transparency, explicit save and focus passed.');
