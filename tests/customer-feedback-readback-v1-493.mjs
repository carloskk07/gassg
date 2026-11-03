import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const backend=read('js/backend.js');
const customer=read('js/customer.js');
const edge=read('supabase/functions/customer-care/index.ts');
const getter=read('supabase/functions/get-order/index.ts');
const start=backend.indexOf('async function liveSubmitFeedback(');
const end=backend.indexOf('\nasync function liveOpenSupportCase(',start);
assert.ok(start>0&&end>start,'feedback operation must remain in the canonical backend');
const code=backend.slice(start,end);
new vm.Script(code);
const A='11111111-1111-4111-8111-111111111111';
const B='22222222-2222-4222-8222-222222222222';

function deferred(){
 let resolve;
 const promise=new Promise(r=>{resolve=r});
 return {promise,resolve};
}
function fixture({mode='success',readback='applied',delay=null,existing=null}={}){
 const calls=[],renders=[];
 let currentMode=mode,currentRead=readback;
 const rt={requested:true,status:'ready',session:{user:{id:'buyer-one'}},
   orderId:A,order:{orderId:A,status:'SETTLED',version:4,feedback:existing},
   orderCheckedAt:'2020-01-01T00:00:00Z',orderCheckedId:A,
   customerFeedbackToken:null,actionPending:false,error:null};
 const ctx=vm.createContext({
  liveRuntime:rt,Date,
  liveReady:()=>rt.status==='ready',
  isAmbiguousTransportError:e=>e?.code==='NETWORK_TIMEOUT'||Number(e?.status)>=500,
  liveInvoke:async(name,body)=>{
   calls.push({name,body,actor:rt.session?.user?.id});
   if(delay)await delay.promise;
   if(currentMode==='lost-ack'){
    const e=Error('unknown completion');e.code='NETWORK_TIMEOUT';throw e;
   }
   if(currentMode==='definite-error'){
    const e=Error('rejected');e.status=400;throw e;
   }
   return {ok:true,feedback:{orderId:currentMode==='foreign-ack'?B:A,
     rating:body.rating,tags:[]}};
  },
  liveGetOrder:async(orderId,{silent})=>{
   calls.push({name:'get-order',orderId,silent});
   if(currentRead==='unavailable')throw Error('network unavailable');
   const fresh={orderId:A,status:'SETTLED',version:4,
    feedback:currentRead==='missing'?null:{rating:5,tags:[]}};
   if(currentRead==='applied'||currentRead==='missing'){
    rt.order=fresh;
    rt.orderCheckedAt=new Date().toISOString();
    rt.orderCheckedId=A;
   }
   return fresh;
  },
  render:()=>renders.push({actor:rt.session?.user?.id,order:rt.orderId})
 });
 vm.runInContext(code+'\nthis.submit=liveSubmitFeedback;',ctx);
 return {rt,calls,renders,submit:(n=5)=>ctx.submit(n),
  mode:v=>currentMode=v,read:v=>currentRead=v};
}

{
 const x=fixture();
 assert.equal(await x.submit(),true,'the confirmed same-order feedback is visible');
 assert.equal(x.calls.filter(c=>c.name==='customer-care').length,1);
 assert.equal(x.calls.filter(c=>c.name==='get-order').length,1);
 assert.equal(x.rt.order.feedback.rating,5);
 assert.equal(x.rt.customerFeedbackToken,null);
 assert.equal(x.renders.length,2,'start and finish redraw');
}
{
 const x=fixture({mode:'lost-ack'});
 assert.equal(await x.submit(),true,'lost ACK recovers from exact applied feedback');
 assert.equal(x.calls.filter(c=>c.name==='customer-care').length,1,
  'network loss after write MUST NOT replay the mutating upsert');
}
{
 const x=fixture({mode:'lost-ack',readback:'unavailable'});
 await assert.rejects(()=>x.submit(),/conexão foi interrompida/i);
 assert.equal(x.calls.filter(c=>c.name==='customer-care').length,1);
 assert.equal(x.rt.customerFeedbackToken,null);
}
{
 const x=fixture({readback:'discarded'});
 await assert.rejects(()=>x.submit(),/não foi confirmada/i,
  'a returned JSON is not proof unless the tracking installed it');
 assert.equal(x.rt.order.feedback,null);
}
{
 const x=fixture({readback:'missing'});
 await assert.rejects(()=>x.submit(),/não foi confirmada/i,
  'an applied order lacking feedback is not success');
}
{
 const x=fixture({mode:'foreign-ack'});
 await assert.rejects(()=>x.submit(),/não confirmou a avaliação/i);
 assert.equal(x.calls.filter(c=>c.name==='get-order').length,0,
  'contradictory ACK is not an ambiguous transport error');
}
{
 const x=fixture({mode:'definite-error'});
 await assert.rejects(()=>x.submit(),/rejected/);
 assert.equal(x.calls.filter(c=>c.name==='customer-care').length,1);
 assert.equal(x.calls.filter(c=>c.name==='get-order').length,0);
}
{
 const x=fixture({existing:{rating:1}});
 await assert.rejects(()=>x.submit(),/já possui uma avaliação/i);
 assert.equal(x.calls.length,0);
}
{
 const x=fixture();
 x.rt.orderId=B;
 await assert.rejects(()=>x.submit(),/Atualize o pedido/i);
 assert.equal(x.calls.length,0);
}
{
 const waiting=deferred(),x=fixture({delay:waiting});
 const old=x.submit();
 assert.equal(x.rt.customerFeedbackToken.actor,'buyer-one');
 assert.equal(await x.submit(),false,'rapid second tap cannot send another upsert');
 assert.equal(x.calls.filter(c=>c.name==='customer-care').length,1);
 waiting.resolve();
 assert.equal(await old,true);
}
{
 const waiting=deferred(),x=fixture({delay:waiting});
 const old=x.submit();
 const originalRenders=x.renders.length;
 x.rt.session={user:{id:'buyer-two'}};
 x.rt.orderId=B;
 x.rt.order={orderId:B,status:'SETTLED',version:1,feedback:null};
 waiting.resolve();
 assert.equal(await old,false,'late ACK does not confirm in new account');
 assert.equal(x.renders.length,originalRenders,'old completion cannot repaint account B');
 assert.equal(x.rt.orderId,B);
}
{
 const waiting=deferred(),x=fixture({delay:waiting,mode:'lost-ack'});
 const old=x.submit();
 x.rt.status='loading';
 x.rt.session=null;
 x.rt.customerFeedbackToken=null;
 waiting.resolve();
 assert.equal(await old,false,'logout during lost ACK cannot load private feedback');
 assert.equal(x.calls.filter(c=>c.name==='get-order').length,0);
}
assert.ok(!code.includes('retryAmbiguousOnce'),'feedback cannot repeat non-idempotent write');
assert.match(backend,/function liveForgetAccount\(\)\{[\s\S]*?liveRuntime\.customerFeedbackToken=null;/);
assert.match(customer,/feedbackPending\?'disabled'/,'buttons disabled during single write');
assert.match(customer,/if\(confirmed===true\)/,'success toast requires applied feedback');
assert.match(edge,/\.from\("order_feedback"\)[\s\S]*?\.upsert\(/,
 'feedback is persisted server-side, not in the customer runtime');
assert.match(edge,/\.eq\("customer_id",user\.id\)/,'server must scope order to buyer');
assert.match(getter,/\.from\("order_feedback"\)[\s\S]*?\.eq\("customer_id",user\.id\)/,
 'get-order confirms feedback through authenticated buyer-scoped server read');
assert.ok(read('.github/workflows/audit.yml').includes(
 'node tests/customer-feedback-readback-v1-493.mjs'));
console.log('PASS #493 feedback end-to-end: one write, lost ACK readback, exact account and order, stale read rejected, UI confirmation only after server proof.');
