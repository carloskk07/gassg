import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const merchant=read('js/merchant.js');
const backend=read('js/backend.js');
const audit=read('.github/workflows/audit.yml');
new vm.Script(merchant,{filename:'merchant.js'});

const cut=(name,async=false)=>{
 const anchor=(async?'async ':'')+'function '+name+'(';
 const i=merchant.indexOf(anchor),j=merchant.indexOf('\n}',i);
 assert.ok(i>=0&&j>i,'missing '+name);
 return merchant.slice(i,j+2);
};
const orderId='11111111-1111-4111-8111-111111111111';
const deliveryUserId='22222222-2222-4222-8222-222222222222';
const notices=[],requests=[];
const runtime={status:'ready',actionPending:false,
 merchant:{memberRole:'manager'},orders:[{orderId,status:'PREPARING'}]};
const controls={
 ['delivery-'+orderId]:{value:deliveryUserId},
 ['delivery-save-'+orderId]:{disabled:false,textContent:'Confirmar responsável'},
 ['reason-'+orderId]:{value:'stock_issue'},
 ['merchant-incident-confirm-'+orderId]:{checked:true}
};
let failure=null,autoRescue=null;
const respond=async(tag)=>{
 requests.push(tag);
 if(failure)throw new Error(failure);
 return autoRescue||{ok:true};
};
const context=vm.createContext({
 globalThis:{merchantRuntime:runtime},toast:message=>notices.push(String(message)),
 document:{getElementById:id=>controls[id]||null},
 merchantPerformAction:async(id,action,reason)=>respond('perform:'+action),
 merchantAssignDeliveryLive:async()=>respond('assign'),
 merchantCompleteDeliveryLive:async()=>respond('deliver'),
 merchantDeliveryCandidates:()=>[{userId:deliveryUserId}],
 merchantDeliveryConfirmationState:()=>({paid:true,pinReady:true,pin:'1234'}),
 merchantIncidentAdvice:()=>true
});
vm.runInContext([
 cut('merchantPostActionConfirmation'),cut('merchantLiveAction',true),
 cut('merchantLiveCannotFulfill',true),cut('merchantLiveAssignDelivery',true),
 cut('merchantLiveDeliver',true)
].join('\n')+
 '\nthis.action=merchantLiveAction;this.cannot=merchantLiveCannotFulfill;'+
 'this.assign=merchantLiveAssignDelivery;this.deliver=merchantLiveDeliver;'+
 'this.feedback=merchantPostActionConfirmation;',context);

assert.equal(context.feedback('Pedido aceito'),true);
assert.equal(notices.pop(),'Pedido aceito');
runtime.status='unavailable';
assert.equal(context.feedback('Pedido aceito'),false);
let notice=notices.pop();
assert.match(notice,/servidor respondeu/i);
assert.match(notice,/não conseguimos reconferir a fila/i);
assert.match(notice,/Atualize os pedidos/);
assert.doesNotMatch(notice,/Pedido aceito/);

for(const status of ['unavailable','no-access','unauthenticated']){
 runtime.status=status;
 await context.action(orderId,'accept');
 assert.match(notices.pop(),/Atualize os pedidos antes de continuar/);
 assert.doesNotMatch(notices.join('\n'),/Pedido aceito/);
}
runtime.status='ready';
await context.action(orderId,'accept');
assert.equal(notices.pop(),'Pedido aceito');
await context.action(orderId,'reject');
assert.equal(notices.pop(),'Pedido devolvido ao matching');
await context.action(orderId,'dispatch');
assert.equal(notices.pop(),'Saída confirmada');
await context.action(orderId,'arriving');
assert.equal(notices.pop(),'Chegada confirmada');

runtime.status='unavailable';
await context.cannot(orderId);
assert.match(notices.pop(),/Atualize os pedidos/);
runtime.status='ready';
await context.cannot(orderId);
assert.equal(notices.pop(),'Impossibilidade registrada. Confira o estado atualizado do pedido.');

runtime.status='unavailable';
await context.assign(orderId);
assert.match(notices.pop(),/Atualize os pedidos/);
assert.equal(controls['delivery-save-'+orderId].disabled,false,'form re-enabled even if recheck fails');
runtime.status='ready';
await context.assign(orderId);
assert.equal(notices.pop(),'Responsável pela entrega confirmado');

runtime.status='unavailable';
await context.deliver(orderId);
assert.match(notices.pop(),/Atualize os pedidos/);
runtime.status='ready';
await context.deliver(orderId);
assert.equal(notices.pop(),'Entrega e pagamento confirmados');

autoRescue={autoRescued:true,rescueReason:'offer_expired'};
await context.action(orderId,'accept');
assert.match(notices.pop(),/prazo expirou/i,'auto rescue retains truthful notice');
autoRescue=null;
failure='Erro ao atualizar pedido';
await context.action(orderId,'dispatch');
assert.equal(notices.pop(),'Erro ao atualizar pedido','no fake success on mutation error');
await context.deliver(orderId);
assert.equal(notices.pop(),'Erro ao atualizar pedido');
failure=null;
runtime.actionPending=true;
const before=requests.length;
await context.action(orderId,'accept');
await context.deliver(orderId);
await context.cannot(orderId);
await context.assign(orderId);
assert.equal(requests.length,before,'concurrent user action does not issue extra mutations');
runtime.actionPending=false;
assert.ok(backend.includes('async function merchantRefreshAfterConfirmedMutation()'));
assert.ok(backend.includes("merchantRuntime.status='unavailable'"),'backend already fails closed when the post-action read fails');
assert.ok(!cut('merchantPostActionConfirmation').includes('merchantPerformAction('),
 'feedback helper is read-only and cannot mutate a business state');
assert.ok(audit.includes('node tests/merchant-post-action-feedback-v1-357.mjs'));
console.log('TAMÃO V1.357 PASS — distinguish acknowledged mutation from unverified queue in accept, reject, incident, assignment, delivery and errors.');
