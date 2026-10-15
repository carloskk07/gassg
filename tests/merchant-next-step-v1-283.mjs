import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const src=read('js/merchant.js'),workflow=read('.github/workflows/audit.yml');
new vm.Script(src,{filename:'merchant.js'});
const take=name=>{
  const p=src.indexOf('function '+name+'('),q=src.indexOf('\n}',p);
  assert.ok(p>=0&&q>p,'missing '+name);
  return src.slice(p,q+2);
};
const id='11111111-1111-4111-8111-111111111111';
const other='22222222-2222-4222-8222-222222222222';
const order={orderId:id,status:'OFFERED_TO_MERCHANT',offerExpiresAt:new Date(Date.now()+15*60000).toISOString()};
const rt={status:'ready',merchant:{merchantId:'merchant-1',memberRole:'owner'},orders:[order],actionPending:false};
const events=[];
let details={tagName:'DETAILS',open:false,parentElement:null};
const el=(key,values={})=>({key,disabled:false,parentElement:details,
 scrollIntoView:()=>events.push('scroll:'+key),focus:()=>events.push('focus:'+key),...values});
const card=el('card',{parentElement:details});
const accept=el('accept'),dispatch=el('dispatch'),select=el('select');
const arriving=el('arriving'),paid=el('paid',{checked:false});
const pin=el('pin',{value:''}),submit=el('submit');
let buttons=accept,assignment=null,visible=true;
card.querySelector=selector=>{
  if(selector.includes('delivery-'+id))return assignment;
  if(selector.includes('live-paid-'+id))return paid;
  if(selector.includes('live-pin-'+id))return pin;
  if(selector.includes('live-deliver-submit-'+id))return submit;
  if(selector.includes('merchant-order-action-fieldset'))return buttons;
  return null;
};
const dom={getElementById:key=>visible&&key==='merchant-order-card-'+id?card:null};
const ctx=vm.createContext({Date,document:dom,globalThis:{merchantRuntime:rt}});
vm.runInContext(take('merchantFocusLiveOrder')+'\n'+take('merchantOrderNextStepLabel')+'\n'+
  take('merchantFocusOrderNextStep')+
  ';this.jump=merchantFocusOrderNextStep;this.label=merchantOrderNextStepLabel;',ctx);
function run(status,{assigned=false}={}){
  order.status=status;
  order.assignedDeliveryUserId=assigned?'33333333-3333-4333-8333-333333333333':null;
  events.length=0;details.open=false;
  return ctx.jump(id);
}
assert.equal(ctx.label(order),'Conferir aceite');
assert.equal(run('OFFERED_TO_MERCHANT'),true);
assert.deepEqual(events,['scroll:card','focus:card','scroll:accept','focus:accept']);
assert.equal(details.open,true);
order.offerExpiresAt=new Date(Date.now()-10000).toISOString();
assert.equal(run('OFFERED_TO_MERCHANT'),true);
assert.deepEqual(events,['scroll:card','focus:card'],'expired offers only navigate to card');
order.offerExpiresAt=new Date(Date.now()+100000).toISOString();
assert.equal(ctx.jump(other),false,'foreign order rejected');
assert.equal(ctx.jump("x');alert(1)//"),false,'malformed ID rejected');
visible=false;
assert.equal(ctx.jump(id),false,'missing DOM never acts');
visible=true;
rt.actionPending=true;
assert.equal(ctx.jump(id),false,'navigation blocked during pending transition');
rt.actionPending=false;
rt.status='unauthenticated';
assert.equal(ctx.jump(id),false,'no access without ready authorized session');
rt.status='ready';
rt.merchant.memberRole='guest';
assert.equal(ctx.jump(id),false,'guest cannot access order');
rt.merchant.memberRole='owner';

buttons=dispatch;
assignment=select;
assert.equal(run('PREPARING'),true);
assert.equal(events.at(-1),'focus:select','owner sees assignment before dispatch');
rt.merchant.memberRole='operator';
assert.equal(run('PREPARING'),true);
assert.equal(events.at(-1),'focus:dispatch','operator cannot enter owner assignment flow');
rt.merchant.memberRole='manager';
assert.equal(run('PREPARING',{assigned:true}),true);
assert.equal(events.at(-1),'focus:dispatch');
dispatch.disabled=true;
assert.equal(run('PREPARING',{assigned:true}),true);
assert.deepEqual(events,['scroll:card','focus:card'],'disabled scheduled dispatch is not focused');
dispatch.disabled=false;
assert.equal(run('AT_RISK'),true);
assert.deepEqual(events,['scroll:card','focus:card'],'incident receives review not blind dispatch');

buttons=arriving;
assert.equal(run('OUT_FOR_DELIVERY'),true);
assert.equal(events.at(-1),'focus:arriving');
paid.checked=false;pin.value='';submit.disabled=true;
assert.equal(run('ARRIVING'),true);
assert.equal(events.at(-1),'focus:paid');
paid.checked=true;
assert.equal(run('ARRIVING'),true);
assert.equal(events.at(-1),'focus:pin');
pin.value='1234';submit.disabled=false;
assert.equal(run('ARRIVING'),true);
assert.equal(events.at(-1),'focus:submit');
submit.disabled=true;
assert.equal(run('ARRIVING'),true);
assert.deepEqual(events,['scroll:card','focus:card'],'disabled submit must never focus as if ready');

assert.equal(run('MERCHANT_ACCEPTED'),true);
assert.deepEqual(events,['scroll:card','focus:card']);
assert.equal(run('UNSUPPORTED'),true);
assert.deepEqual(events,['scroll:card','focus:card']);
assert.equal(ctx.label({status:'ARRIVING'}),'Conferir pagamento e PIN');
assert.equal(ctx.label({status:'AT_RISK'}),'Revisar imprevisto');
assert.equal(ctx.label({status:'UNSUPPORTED'}),'Ver pedido');

const jump=take('merchantFocusOrderNextStep');
assert.doesNotMatch(jump,/merchantLiveAction\(|merchantPerformAction\(|merchantLiveDeliver\(|merchantCompleteDeliveryLive\(|\.click\(/);
const overview=take('merchantDailyOverview');
assert.match(overview,/merchantFocusOrderNextStep/);
assert.match(overview,/merchantOrderNextStepLabel/);
assert.match(overview,/const safe=\/\^\[0-9a-f\]/);
assert.match(workflow,/node tests\/merchant-next-step-v1-283.mjs/);
console.log('V1.283 PASS — contextual focus, role/order isolation, expired/disabled safety, PIN/payment and zero transitions.');
