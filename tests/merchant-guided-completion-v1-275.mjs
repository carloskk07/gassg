import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const src=read('js/merchant.js'),css=read('css/components.css'),backend=read('js/backend.js'),audit=read('.github/workflows/audit.yml');
new vm.Script(src,{filename:'merchant.js'});
function cut(name,asynchronous=false){
 const a=src.indexOf((asynchronous?'async ':'')+'function '+name+'(');
 assert.ok(a>=0,'Missing '+name);
 const b=src.indexOf('\n}',a);
 assert.ok(b>a,'No closing brace '+name);
 return src.slice(a,b+2);
}
const esc=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;')
 .replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'","&#39;");
const id='11111111-1111-4111-8111-111111111111';
const focused=[];
const elements={
 ['live-pin-'+id]:{value:'',focus(){focused.push('pin')}},
 ['live-paid-'+id]:{checked:false,focus(){focused.push('payment')}},
 ['live-deliver-submit-'+id]:{disabled:true},
 ['live-delivery-guide-'+id]:{textContent:''}
};
let calls=0,params=[],error=null;
const messages=[];
const runtime={merchant:{memberRole:'operator'},deliveryTeam:[],actionPending:false};
const ctx=vm.createContext({
 globalThis:{merchantRuntime:runtime},
 document:{getElementById:key=>elements[key]||null},
 merchantCompleteDeliveryLive:async(...args)=>{calls++;params.push(args);if(error)throw error;return {};},
 toast:value=>messages.push(String(value))
});
vm.runInContext([
 cut('merchantDeliveryConfirmationState'),
 cut('merchantDeliveryConfirmationChanged'),
 cut('merchantLiveDeliver',true)
].join('\n')+';this.state=merchantDeliveryConfirmationState;this.changed=merchantDeliveryConfirmationChanged;this.deliver=merchantLiveDeliver;',ctx);
assert.equal(ctx.state(id).ready,false);
assert.equal(ctx.state('invalid').ready,false);
assert.equal(ctx.changed('invalid'),false);
assert.equal(ctx.changed(id),false);
assert.equal(elements['live-deliver-submit-'+id].disabled,true);
assert.match(elements['live-delivery-guide-'+id].textContent,/Confirme o recebimento/);

elements['live-pin-'+id].value='1A2 3-4';
assert.equal(ctx.changed(id),false);
assert.equal(elements['live-pin-'+id].value,'1234','Clean pasted PIN safely');
assert.equal(ctx.state(id).pinReady,true);
assert.equal(elements['live-deliver-submit-'+id].disabled,true);
assert.match(elements['live-delivery-guide-'+id].textContent,/Marque pagamento recebido/);
await ctx.deliver(id);
assert.equal(calls,0,'Never send payment unconfirmed');
assert.equal(focused.at(-1),'payment');
elements['live-paid-'+id].checked=true;
assert.equal(ctx.changed(id),true);
assert.equal(elements['live-deliver-submit-'+id].disabled,false);
assert.match(elements['live-delivery-guide-'+id].textContent,/Confira o pedido/);
runtime.actionPending=true;
assert.equal(ctx.changed(id),true);
assert.equal(elements['live-deliver-submit-'+id].disabled,true);
await ctx.deliver(id);
assert.equal(calls,0,'No action while existing transition pending');
runtime.actionPending=false;
elements['live-pin-'+id].value='12';
assert.equal(ctx.changed(id),false);
await ctx.deliver(id);
assert.equal(calls,0,'Never submit two-digit PIN');
assert.equal(focused.at(-1),'pin');
elements['live-pin-'+id].value='1234';
assert.equal(ctx.changed(id),true);
await ctx.deliver(id);
assert.equal(calls,1);
assert.equal(params[0][0],id);
assert.equal(params[0][1],'1234');
assert.equal(params[0][2],true);
assert.equal(messages.at(-1),'Entrega e pagamento confirmados');
error=new Error('PIN incorreto.');
await ctx.deliver(id);
assert.equal(calls,2);
assert.equal(messages.at(-1),'PIN incorreto.','Do not claim success after backend error');
assert.equal(ctx.state("x');alert(1)//").ready,false);
