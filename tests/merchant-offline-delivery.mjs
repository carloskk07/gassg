import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {TextEncoder,TextDecoder} from 'node:util';

// Full WebCrypto AES-GCM against an IndexedDB-like asynchronous request store.
// No commercial backend, real user credentials or browser storage is used.
const source=fs.readFileSync(new URL('../js/merchant-offline-delivery.js',import.meta.url),'utf8');
const rows={keys:new Map(),receipts:new Map(),assignments:new Map()};
const request=operation=>{
  const req={result:undefined,error:null,onsuccess:null,onerror:null};
  queueMicrotask(()=>{
    try{req.result=operation();req.onsuccess?.({target:req})}
    catch(error){req.error=error;req.onerror?.({target:req})}
  });
  return req;
};
const indexedDB={
  open:(name,version)=>{
    assert.equal(name,'tamao-driver-receipts-v1');
    assert.equal(version,2);
    const db={
      objectStoreNames:{contains:n=>rows[n] instanceof Map},
      createObjectStore:n=>{rows[n]=new Map()},
      close(){},
      transaction:(name,mode)=>{
        const tx={oncomplete:null,onerror:null,onabort:null,aborted:false,
          abort(){this.aborted=true;this.onabort?.()},
          objectStore:()=>({
          get:id=>withCommit(()=>rows[name].get(id)),
          getAll:()=>withCommit(()=>[...rows[name].values()]),
          put:row=>withCommit(()=>{rows[name].set(row.id,row);return row.id}),
          add:row=>withCommit(()=>{
            if(rows[name].has(row.id))throw new Error('ConstraintError');
            rows[name].set(row.id,row);return row.id;
          }),
          delete:id=>withCommit(()=>{rows[name].delete(id);return undefined})
        })};
        function withCommit(operation){
          const req=request(operation);
          queueMicrotask(()=>queueMicrotask(()=>{if(!tx.aborted)tx.oncomplete?.()}));
          return req;
        }
        return tx;
      }
    };
    const req={result:db,onsuccess:null,onerror:null,onupgradeneeded:null};
    queueMicrotask(()=>{req.onupgradeneeded?.();req.onsuccess?.({target:req})});
    return req;
  }
};
const userId='11111111-1111-4111-8111-111111111111';
const otherId='99999999-9999-4999-8999-999999999999';
const merchantId='22222222-2222-4222-8222-222222222222';
const orderId='33333333-3333-4333-8333-333333333333';
const rt={
  recentClosedDeliveries:[],
  status:'ready',session:{access_token:'test-not-a-real-token',expires_at:Math.floor(Date.now()/1000)+3600,user:{id:userId}},
  merchant:{merchantId,memberRole:'driver'},lastSyncAt:new Date().toISOString(),
  orders:[{orderId,status:'ARRIVING',version:3,assignedDeliveryUserId:userId,
    addressVisible:true,address:'Rua Fictícia, 123'}]
};
const host={
  textContent:'',children:[],parentElement:{hidden:true,classList:{contains:name=>name==='merchant-driver-receipts'}},
  replaceChildren(){this.children=[]},
  appendChild(el){this.children.push(el)}
};
const pinField={value:'6789'};
const paidField={checked:true};
const savedButton={disabled:false,textContent:'Guardar comprovante (pendente)',
  closest:selector=>selector==='.merchant-driver-local-card'?{}:null};
const offlineGuide={textContent:'A entrega continuará pendente no servidor.'};
const doc={
  getElementById:id=>id==='merchant-offline-receipts'?host:
    id==='live-pin-'+orderId?pinField:
    id==='live-paid-'+orderId?paidField:
    id==='live-deliver-submit-'+orderId?savedButton:
    id==='live-delivery-guide-'+orderId?offlineGuide:null,
  createElement:tag=>({
    tag,textContent:'',className:'',disabled:false,children:[],
    appendChild(child){this.children.push(child)},
    addEventListener(name,fn){this[name]=fn}
  })
};
const toasts=[];
const denied=new Map();
const localStorage={getItem:k=>denied.get(k)??null,setItem:(k,v)=>denied.set(k,String(v)),removeItem:k=>denied.delete(k)};
let confirmations=0;
let refreshed=0;
const ctx={
  indexedDB,crypto:webcrypto,TextEncoder,TextDecoder,Uint8Array,
  navigator:{onLine:false},document:doc,merchantRuntime:rt,localStorage,
  toast:message=>toasts.push(String(message)),
  merchantDeliveryConfirmationState:()=>({pin:pinField.value,paid:true,pinReady:true,ready:true}),
  merchantRefresh:async()=>{
    refreshed++;rt.lastSyncAt=new Date().toISOString();
    // Mirror the production Edge contract: only a PII-free role-scoped
    // closure array proves a terminal result, never an active order.
    rt.recentClosedDeliveries=rt.orders.filter(o=>['DELIVERED','SETTLED'].includes(o.status))
      .map(o=>({orderId:o.orderId,status:o.status,version:o.version,
        assignedDeliveryUserId:o.assignedDeliveryUserId}));
  },
  merchantCompleteDeliveryLive:async(id,pin,paid,key)=>{
    assert.equal(id,orderId);assert.equal(pin,'6789');assert.equal(paid,true);
    assert.match(key,/^complete-delivery:[A-Za-z0-9_-]{16,96}$/);confirmations++;
    return {ok:true,delivered:true};
  },
  confirm:()=>true
};
ctx.globalThis=ctx;
vm.runInNewContext(source,ctx,{filename:'merchant-offline-delivery.js'});
// The offline UI's entry gate is checked before stale addresses or PIN forms
// render. It must never substitute session presence for the actual driver role.
assert.equal(ctx.merchantDriverOfflineAllowed(rt),true,'assigned driver with live session is eligible');
rt.merchant.memberRole='operator';
assert.equal(ctx.merchantDriverOfflineAllowed(rt),false,'operator cannot use offline delivery UI');
rt.merchant.memberRole='driver';
rt.status='no-access';
assert.equal(ctx.merchantDriverOfflineAllowed(rt),false,'revoked/no-access state closes offline UI');
rt.status='ready';
rt.session.user.is_anonymous=true;
assert.equal(ctx.merchantDriverOfflineAllowed(rt),false,'anonymous account cannot open offline delivery');
rt.session.user.is_anonymous=false;
const driverToken=rt.session.access_token;
rt.session.access_token=null;
assert.equal(ctx.merchantDriverOfflineAllowed(rt),false,'no bearer session blocks offline delivery');
rt.session.access_token=driverToken;
const driverUserId=rt.session.user.id;
rt.session.user.id='not-a-uuid';
assert.equal(ctx.merchantDriverOfflineAllowed(rt),false,'malformed identity blocks offline delivery');
rt.session.user.id=driverUserId;
assert.equal(ctx.merchantDriverOfflineAllowed(rt),true,'restored authorized driver remains eligible');
// Offline controls must not use the online confirmation wording after PIN entry.
ctx.esc=value=>String(value||'').replaceAll('&','&amp;').replaceAll('<','&lt;');
const localForm=ctx.merchantDriverOfflineQueue(rt);
assert.match(localForm,/merchantOfflineConfirmationChanged/,'offline fields use local-only validation feedback');
assert.match(localForm,/Guardar comprovante \(pendente\)/);
const guide={textContent:'A entrega continuará pendente no servidor.'};
const originalGetElement=doc.getElementById;
doc.getElementById=id=>id==='live-delivery-guide-'+orderId?guide:originalGetElement(id);
ctx.merchantDeliveryConfirmationChanged=()=>false;
assert.equal(ctx.merchantOfflineConfirmationChanged(orderId),false);
assert.match(guide.textContent,/pendente/);
ctx.merchantDeliveryConfirmationChanged=()=>true;
assert.equal(ctx.merchantOfflineConfirmationChanged(orderId),true);
assert.match(guide.textContent,/continua pendente de validação online/);
assert.doesNotMatch(guide.textContent,/Confirmar entrega|Entrega confirmada/);
doc.getElementById=originalGetElement;

const scope=userId+':'+merchantId;
const recordId=scope+':'+orderId;
// A real server-read snapshot can be encrypted, restored after a cold UI
// reset, and only staged locally. No address, code or token in clear metadata.
assert.equal(await ctx.merchantOfflineDeliveryCacheAssignments(),true);
assert.equal(rows.assignments.size,1);
const cached=rows.assignments.get(scope);
assert.equal(cached.id,scope);
assert.ok(!JSON.stringify(cached).includes('Rua Fictícia'));
assert.ok(!JSON.stringify(cached).includes('test-not-a-real-token'));
const validMerchant=rt.merchant,validOrders=rt.orders,validSync=rt.lastSyncAt;
rt.status='unavailable';rt.merchant=null;rt.orders=[];rt.lastSyncAt=null;
rt.selectedMerchantId=merchantId;
ctx.navigator.onLine=true;
assert.equal(await ctx.merchantOfflineDeliveryRestore(),false,'must not recover when network is online');
ctx.navigator.onLine=false;
// It is already offline for the initial test fixture: recovery is authorized
// only for the same browser session and user.
rt.status='unavailable';
rt.session.expires_at=Math.floor(Date.now()/1000)-1;
assert.equal(await ctx.merchantOfflineDeliveryRestore(),false,'expired Supabase token blocks offline address');
rt.session.expires_at=Math.floor(Date.now()/1000)+3600;
denied.set('tamao-offline-denied:'+scope,'1');
assert.equal(await ctx.merchantOfflineDeliveryRestore(),false,'explicitly revoked assignment must stay locked');
denied.delete('tamao-offline-denied:'+scope);
// Regression: decrypt can take time on a phone. Logging out or swapping
// accounts DURING the awaited AES-GCM operation must not restore old
// addresses/driver role into the new (or signed-out) UI.
let unblockDecrypt, decryptEntered;
const enteredDecrypt=new Promise(resolve=>{decryptEntered=resolve});
const delayedCrypto={
  getRandomValues:array=>webcrypto.getRandomValues(array),
  subtle:{
    decrypt:async(...args)=>{
      decryptEntered();
      await new Promise(resolve=>{unblockDecrypt=resolve});
      return webcrypto.subtle.decrypt(...args);
    }
  }
};
const raceCtx={...ctx,merchantRuntime:rt,crypto:delayedCrypto};
raceCtx.globalThis=raceCtx;
vm.runInNewContext(source,raceCtx,{filename:'merchant-offline-delivery.js'});
const validSessionBeforeLogout=rt.session;
const inflightRestore=raceCtx.merchantOfflineDeliveryRestore();
await enteredDecrypt;
rt.session=null;
rt.status='unauthenticated';
unblockDecrypt();
assert.equal(await inflightRestore,false,'logout during pending decryption must not restore old assignments');
assert.equal(rt.merchant,null,'old driver role must never return after logout');
assert.equal(rt.orders.length,0,'old customer address must remain unavailable after logout');
rt.session=validSessionBeforeLogout;
rt.status='unavailable';
assert.equal(await ctx.merchantOfflineDeliveryRestore(),true);
assert.equal(rt.merchant.memberRole,'driver');
assert.equal(rt.orders[0].address,'Rua Fictícia, 123');
assert.equal(rt.offlineRestored,true);
rt.merchant=null;rt.orders=[];
rt.session={access_token:'other-test-session',expires_at:Math.floor(Date.now()/1000)+3600,user:{id:otherId}};
assert.equal(await ctx.merchantOfflineDeliveryRestore(),false,'wrong account cannot see encrypted snapshot');
rt.session=null;
assert.equal(await ctx.merchantOfflineDeliveryRestore(),false,'signed-out browser cannot recover');
rt.session={access_token:'test-not-a-real-token',user:{id:userId}};
assert.equal(await ctx.merchantOfflineDeliveryRestore(),false,'session without expiry cannot unlock offline address');
rt.status='ready';rt.merchant=validMerchant;rt.orders=validOrders;
rt.lastSyncAt=validSync;
rt.session={access_token:'test-not-a-real-token',expires_at:Math.floor(Date.now()/1000)+3600,user:{id:userId}};
await ctx.merchantOfflineDeliverySaveFromUi(orderId);
assert.equal(pinField.value,'','PIN field must be cleared after durable staging');
assert.equal(savedButton.disabled,true,'offline receipt saved disables the repeat action');
assert.equal(savedButton.textContent,'Comprovante guardado (pendente)');
assert.equal(pinField.disabled,true,'protected offline PIN cannot be retyped to re-enable submit');
assert.equal(paidField.disabled,true,'payment checkbox is locked until local proof clears');
assert.match(offlineGuide.textContent,/só será confirmada após conferência online/);
assert.equal(paidField.checked,false,'saved receipt clears the local payment checkbox');
assert.equal(rows.receipts.size,1);
assert.equal(host.parentElement.hidden,false,'pending encrypted proof automatically reveals section');
denied.set('tamao-offline-denied:'+scope,'1');
assert.equal(await ctx.merchantOfflineDeliveryCacheAssignments(),false,'denied role cannot refresh encrypted assignment cache');
await ctx.merchantOfflineDeliverySaveFromUi(orderId);
assert.equal(rows.receipts.size,1,'role denial cannot overwrite proof');
denied.delete('tamao-offline-denied:'+scope);
const encrypted=rows.receipts.get(recordId);
assert.ok(Array.isArray(encrypted.ciphertext)&&encrypted.ciphertext.length>24);
assert.ok(Array.isArray(encrypted.iv)&&encrypted.iv.length===12);
assert.ok(!('pin' in encrypted)&&!('address' in encrypted),'no PIN/address in clear metadata');
assert.ok(!('idempotencyKey' in encrypted),'retry identifier must be inside AES-GCM ciphertext');
assert.ok(rows.keys.get(scope).key.extractable===false,'persisted AES key must be non-extractable');
assert.ok(toasts.some(x=>x.includes('PENDENTE')),'staging is never server success');
assert.equal(confirmations,0,'offline must not send requests');
// Receipt insertion must atomically check and write in one readwrite
// transaction, rather than an earlier read followed by a separate put.
assert.match(source,/async function receiptTransaction\(id,mutate\)/);
assert.match(source,/await receiptTransaction\(receiptId,\(store,existing\)=>\{/);
assert.match(source,/if\(existing&&Number\(existing\.expiresAt\)>Date\.now\(\)\)/);
assert.match(source,/store\.put\(entry\)/);
assert.match(source,/await receiptTransaction\(item\.id,\(store,current\)=>\{/);
// A second PIN must not overwrite a pending proof without an explicit discard.
pinField.value='9999';
await ctx.merchantOfflineDeliverySaveFromUi(orderId);
assert.equal(rows.receipts.size,1);
assert.equal(rows.receipts.get(recordId).ciphertext.length,encrypted.ciphertext.length);
assert.ok(toasts.some(x=>x.includes('Já existe comprovante pendente')));
pinField.value='6789';

// Page reload uses a new JS context and the same durable browser database.
const afterReload={...ctx,merchantRuntime:rt};
afterReload.globalThis=afterReload;
vm.runInNewContext(source,afterReload,{filename:'merchant-offline-delivery.js'});
await afterReload.merchantOfflineDeliveryShowPending();
assert.equal(host.children.length,2,'persisted receipt must reappear after reload');
assert.equal(host.parentElement.hidden,false,'reloaded pending proof visible without a second click');

// A different authenticated account on the same device cannot enumerate it.
rt.session={access_token:'other-test-session',expires_at:Math.floor(Date.now()/1000)+3600,user:{id:otherId}};
rt.orders[0].assignedDeliveryUserId=otherId;
await afterReload.merchantOfflineDeliveryShowPending();
assert.equal(host.children.length,0);
assert.equal(host.textContent,'Nenhum comprovante local pendente.');
assert.equal(host.parentElement.hidden,true,'other account sees no empty-proof panel');
rt.session={access_token:'test-not-a-real-token',expires_at:Math.floor(Date.now()/1000)+3600,user:{id:userId}};
rt.orders[0].assignedDeliveryUserId=userId;
rt.lastSyncAt=new Date().toISOString();

// Conflicting server version must never submit or erase the encrypted proof.
ctx.navigator.onLine=true;
rt.orders[0].version=4;
await afterReload.merchantOfflineDeliveryReconcile(orderId);
assert.equal(confirmations,0);
assert.ok(rows.receipts.has(recordId),'version mismatch retains local proof');
assert.ok(toasts.some(x=>x.includes('Versão do pedido mudou')));

// A failed server request keeps the record pending rather than lying.
rt.orders[0].version=3;
afterReload.merchantCompleteDeliveryLive=async()=>{throw new Error('API indisponível')};
await afterReload.merchantOfflineDeliveryReconcile(orderId);
assert.ok(rows.receipts.has(recordId));
assert.equal(confirmations,0);
afterReload.merchantCompleteDeliveryLive=async(id,pin,paid,key)=>{
  assert.equal(id,orderId);assert.equal(pin,'6789');assert.equal(paid,true);
  assert.match(key,/^complete-delivery:[A-Za-z0-9_-]{16,96}$/);confirmations++;
  rt.orders[0].status='DELIVERED';rt.orders[0].version=4;
  await afterReload.merchantRefresh();
  return {ok:true,delivered:true};
};
await afterReload.merchantOfflineDeliveryReconcile(orderId);
assert.equal(confirmations,1,'one authorized replay after rereading server');
assert.equal(rows.receipts.size,0,'local receipt erased only after confirmed server call');
assert.equal(savedButton.textContent,'Guardar comprovante (pendente)','reconciled proof resets local staging button');
assert.equal(savedButton.disabled,true,'reset needs a new PIN and payment confirmation');
assert.equal(pinField.disabled,false,'confirmed proof unlocks field for a future independent order');
assert.equal(paidField.disabled,false,'confirmed proof unlocks checkbox');
assert.ok(refreshed>=3);
assert.ok(toasts.some(x=>x.includes('confirmada pelo servidor')));
rt.orders[0].status='ARRIVING';rt.orders[0].version=3;

// Two tabs may hold the same driver's authorized receipt. If a second tab
// explicitly discards/replaces it while the first waits for ACK, the first
// must never erase that newer AES-GCM ciphertext.
pinField.value='6789';
await afterReload.merchantOfflineDeliverySaveFromUi(orderId);
const originalIv=[...rows.receipts.get(recordId).iv];
afterReload.merchantCompleteDeliveryLive=async()=>{
  await ctx.merchantOfflineDeliveryShowPending();
  const otherTabDiscard=host.children[1].children[2];
  assert.equal(typeof otherTabDiscard.click,'function');
  await otherTabDiscard.click();
  assert.equal(rows.receipts.has(recordId),false,'other tab discarded only its own proof');
  pinField.value='6789';
  await ctx.merchantOfflineDeliverySaveFromUi(orderId);
  const saved=rows.receipts.get(recordId);
  assert.ok(saved,'other tab wrote the replacement proof');
  assert.notDeepEqual(saved.iv,originalIv,'replacement carries a new random AES-GCM IV');
  rt.orders[0].status='DELIVERED';rt.orders[0].version=4;
  await afterReload.merchantRefresh();
  return {ok:true,delivered:true};
};
ctx.navigator.onLine=true;
await afterReload.merchantOfflineDeliveryReconcile(orderId);
assert.ok(rows.receipts.has(recordId),'ACK cleanup must not delete the replacement proof');
assert.notDeepEqual(rows.receipts.get(recordId).iv,originalIv);
rt.orders[0].status='ARRIVING';rt.orders[0].version=3;
await afterReload.merchantOfflineDeliveryShowPending();
// A stale discard dialog in the first tab must not erase a replacement.
const staleDiscard=host.children[1].children[2];
const previousIv=[...rows.receipts.get(recordId).iv];
rows.receipts.delete(recordId); // other tab discarded/replaced after dialog opened
pinField.value='6789'; // saving the previous receipt deliberately cleared the PIN field
await ctx.merchantOfflineDeliverySaveFromUi(orderId);
assert.notDeepEqual(rows.receipts.get(recordId).iv,previousIv);
await staleDiscard.click();
assert.ok(rows.receipts.has(recordId),'stale discard must not delete a newer saved proof');
assert.notDeepEqual(rows.receipts.get(recordId).iv,previousIv);
rows.receipts.delete(recordId); // test fixture reset without a commercial mutation
afterReload.merchantCompleteDeliveryLive=ctx.merchantCompleteDeliveryLive;

// Positive HTTP ACK with a stale ARRIVING snapshot does not prove delivery.
pinField.value='6789';
await afterReload.merchantOfflineDeliverySaveFromUi(orderId);
assert.equal(rows.receipts.size,1);
let unverifiedAcks=0;
afterReload.merchantCompleteDeliveryLive=async()=>{unverifiedAcks++;return {ok:true,delivered:true}};
await afterReload.merchantOfflineDeliveryReconcile(orderId);
assert.equal(unverifiedAcks,1);
assert.ok(rows.receipts.has(recordId),'successful HTTP reply without fresh DELIVERED state must retain receipt');
assert.ok(toasts.some(t=>t.includes('confirmação final não apareceu')));
// Even after an ACK is lost, mismatched delivery versions remain a conflict.
rt.orders[0].status='DELIVERED';rt.orders[0].version=5;
await afterReload.merchantOfflineDeliveryReconcile(orderId);
assert.ok(rows.receipts.has(recordId),'DELIVERED with unrelated version is not proof of this receipt');
rt.orders[0].version=4;
await afterReload.merchantOfflineDeliveryReconcile(orderId);
assert.equal(unverifiedAcks,1,'already-confirmed server delivery must not resend the PIN');
assert.equal(rows.receipts.size,0,'fresh versioned DELIVERED order reconciles lost ACK safely');
rt.orders[0].status='ARRIVING';rt.orders[0].version=3;
afterReload.merchantCompleteDeliveryLive=ctx.merchantCompleteDeliveryLive;

// Invalid PIN and wrong assignment must fail closed even when offline.
pinField.value='12';
await afterReload.merchantOfflineDeliverySaveFromUi(orderId);
assert.equal(rows.receipts.size,0);
pinField.value='6789';
rt.orders[0].assignedDeliveryUserId=otherId;
await afterReload.merchantOfflineDeliverySaveFromUi(orderId);
assert.equal(rows.receipts.size,0);
rt.orders[0].assignedDeliveryUserId=userId;
await afterReload.merchantOfflineDeliverySaveFromUi(orderId);
assert.equal(rows.receipts.size,1);
rows.receipts.get(recordId).expiresAt=Date.now()-1;
await afterReload.merchantOfflineDeliveryShowPending();
assert.equal(rows.receipts.size,0,'expired receipt must be purged, never replayed');
assert.equal(host.parentElement.hidden,true,'expired receipt leaves driver dashboard uncluttered');
// Expired assignment ciphertext must not revive an address or remain locally.
ctx.navigator.onLine=false;
rt.status='unavailable';rt.merchant=null;rt.orders=[];
rt.selectedMerchantId=merchantId;
rows.assignments.get(scope).expiresAt=Date.now()-1;
assert.equal(await afterReload.merchantOfflineDeliveryRestore(),false);
assert.equal(rows.assignments.has(scope),false,'expired address ciphertext is erased');
rt.status='ready';rt.merchant=validMerchant;rt.orders=validOrders;
rt.session={access_token:'test-not-a-real-token',expires_at:Math.floor(Date.now()/1000)-1,user:{id:userId}};
pinField.value='6789';
await afterReload.merchantOfflineDeliverySaveFromUi(orderId);
assert.equal(rows.receipts.size,0,'expired token also blocks staging new offline proof');



const merchantSource=fs.readFileSync(new URL('../js/merchant-offline-delivery.js',import.meta.url),'utf8');
const start=merchantSource.indexOf('  function merchantDriverOfflineQueue(rt){');
const end=merchantSource.indexOf('\n  globalThis.merchantDriverOfflineAllowed=offlineAllowed;',start);
assert.ok(start>=0&&end>start,'missing restricted stale-snapshot UI');
const escape=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const screen=vm.createContext({esc:escape,Date,localStorage,sessionValid:s=>Number.isSafeInteger(s?.expires_at)&&s.expires_at*1000>Date.now()});
vm.runInContext(merchantSource.slice(start,end)+';this.view=merchantDriverOfflineQueue;',screen);
const rtView={
  status:'unavailable',session:{access_token:'synthetic',expires_at:Math.floor(Date.now()/1000)+3600,user:{id:userId}},
  merchant:{merchantId,memberRole:'driver'},lastSyncAt:new Date().toISOString(),
  orders:[{orderId,publicCode:'SIM-123',status:'ARRIVING',version:3,
    assignedDeliveryUserId:userId,addressVisible:true,address:'Rua Fictícia 123'}]
};
const offlineHtml=screen.view(rtView);
assert.match(offlineHtml,/SIM-123/);
rtView.session.expires_at=Math.floor(Date.now()/1000)-1;
assert.equal(screen.view(rtView),'','expired session cannot show stale offline address');
rtView.session.expires_at=Math.floor(Date.now()/1000)+3600;
localStorage.setItem('tamao-offline-denied:'+scope,'1');
assert.equal(screen.view(rtView),'','revoked session cannot show stale offline address');
localStorage.removeItem('tamao-offline-denied:'+scope);
assert.match(offlineHtml,/Rua Fictícia 123/);
assert.match(offlineHtml,/Guardar comprovante \(pendente\)/);
assert.doesNotMatch(offlineHtml,/merchantLiveDeliver|merchantPerformAction|merchantLiveAction/);
rtView.orders[0].assignedDeliveryUserId=otherId;
assert.equal(screen.view(rtView),'',"other driver's last-known delivery must not render");
rtView.orders[0].assignedDeliveryUserId=userId;
rtView.lastSyncAt=new Date(Date.now()-5*60*60*1000).toISOString();
assert.equal(screen.view(rtView),'','expired server snapshot must not expose address or PIN form');


// The pre-disconnect request and the later offline replay must use exactly the
// same idempotency key, including when an HTTP ACK was lost after a write.
const backendSrc=fs.readFileSync(new URL('../js/backend.js',import.meta.url),'utf8');
const begin=backendSrc.indexOf('async function merchantCompleteDeliveryLive(');
const finish=backendSrc.indexOf('\n}',begin);
assert.ok(begin>=0&&finish>begin);
const sent=[];
const networkContext=vm.createContext({
 merchantRuntime:{status:'ready',actionPending:false,error:null},
 merchantVerifiedActionOrder:()=>({version:3}),
 render:()=>{},liveIdempotency:()=> 'complete-delivery:12345678-1234-4234-8234-123456789abc',
 retryAmbiguousOnce:f=>f(),
 merchantInvoke:async(name,body,options)=>{
  assert.equal(name,'complete-delivery');sent.push({body,options});
  throw new TypeError('ACK not received');
 },
 merchantRefresh:async()=>null
});
vm.runInContext(backendSrc.slice(begin,finish+2)+';this.complete=merchantCompleteDeliveryLive;',networkContext);
let retryKey='';
await assert.rejects(async()=>{
 try{await networkContext.complete(orderId,'6789',true)}
 catch(error){
  retryKey=error.deliveryIdempotencyKey;
  throw error;
 }
},/ACK not received/);
assert.match(retryKey,/^complete-delivery:[A-Za-z0-9_-]{16,96}$/);
await assert.rejects(()=>networkContext.complete(orderId,'6789',true,retryKey),/ACK not received/);
assert.equal(sent.length,2);
assert.equal(sent[0].options.idempotencyKey,retryKey);
assert.equal(sent[1].options.idempotencyKey,retryKey);
assert.equal(sent[1].body.expectedVersion,3);


// Offline at the doorstep before "Estou chegando": keep the original
// OUT_FOR_DELIVERY proof and authorize arrival online, strictly in sequence.
rt.status='ready';rt.session={access_token:'test-not-a-real-token',expires_at:Math.floor(Date.now()/1000)+3600,user:{id:userId}};
rt.merchant=validMerchant;rt.selectedMerchantId=merchantId;
rt.orders=[{...validOrders[0],status:'OUT_FOR_DELIVERY',version:12}];
rt.lastSyncAt=new Date().toISOString();rt.actionPending=false;
pinField.value='6789';ctx.navigator.onLine=false;
assert.equal(await afterReload.merchantOfflineDeliveryCacheAssignments(),true);
assert.ok(!JSON.stringify(rows.assignments.get(scope)).includes('Rua Fictícia'));
rt.status='unavailable';rt.merchant=null;rt.orders=[];rt.lastSyncAt=null;
assert.equal(await afterReload.merchantOfflineDeliveryRestore(),true);
assert.equal(rt.orders[0].status,'OUT_FOR_DELIVERY','out for delivery recovered after offline restart');
assert.match(screen.view({...rt,orders:rt.orders}),/Chegada ainda não registrada/);
await afterReload.merchantOfflineDeliverySaveFromUi(orderId);
assert.equal(rows.receipts.size,1);
assert.ok(!JSON.stringify(rows.receipts.get(recordId)).includes('OUT_FOR_DELIVERY'),'status is encrypted');
rt.status='ready';rt.merchant=validMerchant;rt.orders=[{...validOrders[0],status:'OUT_FOR_DELIVERY',version:12}];
rt.lastSyncAt=new Date().toISOString();ctx.navigator.onLine=true;
let arrivals=0,onlineCompletions=0;
afterReload.merchantPerformAction=async(id,action)=>{
  assert.equal(id,orderId);assert.equal(action,'arriving');arrivals++;
  rt.orders[0].status='ARRIVING';rt.orders[0].version++;
  return {ok:true,arriving:true};
};
afterReload.merchantCompleteDeliveryLive=async(id,pin,paid,key)=>{
  assert.equal(id,orderId);assert.equal(pin,'6789');assert.equal(paid,true);
  assert.match(key,/^complete-delivery:/);onlineCompletions++;
  return {ok:true,delivered:true};
};
rt.orders[0].status='CANCELLED';
await afterReload.merchantOfflineDeliveryReconcile(orderId);
assert.equal(arrivals,0);assert.equal(onlineCompletions,0);
rt.orders[0].status='OUT_FOR_DELIVERY';rt.orders[0].version=13;
await afterReload.merchantOfflineDeliveryReconcile(orderId);
assert.equal(arrivals,0);assert.equal(onlineCompletions,0,'changed version cannot silently arrive');
rt.orders[0].version=12;
rt.actionPending=true;
await afterReload.merchantOfflineDeliveryReconcile(orderId);
assert.equal(arrivals,0);assert.equal(onlineCompletions,0,'concurrent operation is not an ACK');
rt.actionPending=false;
afterReload.merchantCompleteDeliveryLive=async()=>{onlineCompletions++;throw Error('Provider 503')};
await afterReload.merchantOfflineDeliveryReconcile(orderId);
assert.equal(arrivals,1,'arrival transition performed exactly once');
assert.equal(rt.orders[0].status,'ARRIVING');
assert.equal(rt.orders[0].version,13);
assert.equal(onlineCompletions,1);
assert.ok(rows.receipts.has(recordId),'failed delivery ACK preserves encrypted proof');
afterReload.merchantCompleteDeliveryLive=async(id,pin,paid,key)=>{
  assert.equal(id,orderId);assert.equal(pin,'6789');assert.equal(paid,true);
  assert.match(key,/^complete-delivery:/);onlineCompletions++;
  rt.orders[0].status='DELIVERED';rt.orders[0].version=14;
  await afterReload.merchantRefresh();
  return {ok:true,delivered:true};
};
await afterReload.merchantOfflineDeliveryReconcile(orderId);
assert.equal(arrivals,1,'already-acknowledged arrival must not be replayed');
assert.equal(onlineCompletions,2);
assert.equal(rows.receipts.size,0,'proof erased only after delivery confirmation');
// A false truthy UI return with no server evidence must not delete a proof.
rt.orders[0].status='OUT_FOR_DELIVERY';rt.orders[0].version=22;
rt.lastSyncAt=new Date().toISOString();pinField.value='6789';ctx.navigator.onLine=false;
await afterReload.merchantOfflineDeliverySaveFromUi(orderId);
assert.equal(rows.receipts.size,1);
ctx.navigator.onLine=true;
afterReload.merchantPerformAction=async()=>{
  arrivals++;return {ok:true}; // server did not advance to ARRIVING
};
await afterReload.merchantOfflineDeliveryReconcile(orderId);
assert.ok(rows.receipts.has(recordId),'arrival response without new server status cannot settle');
assert.equal(onlineCompletions,2);

// The exact production backend guard must persist a denial across browser
// restarts and clear it only when a new authorized driver snapshot arrives.
const guardStart=backendSrc.indexOf('function merchantOfflineGuard(');
const guardEnd=backendSrc.indexOf('\nasync function merchantSignOut()',guardStart);
assert.ok(guardStart>=0&&guardEnd>guardStart);
const guardRuntime={session:{user:{id:userId}},merchant:{merchantId},selectedMerchantId:merchantId};
const guardCtx=vm.createContext({merchantRuntime:guardRuntime,localStorage});
vm.runInContext(backendSrc.slice(guardStart,guardEnd)+';this.guard=merchantOfflineGuard;',guardCtx);
const denyKey='tamao-offline-denied:'+scope;
guardCtx.guard(true);
assert.equal(localStorage.getItem(denyKey),'1','revocation persisted for this user/merchant');
guardCtx.guard(false);
assert.equal(localStorage.getItem(denyKey),null,'authorized fresh read clears the lock');
assert.match(backendSrc,/if\(error\?\.status===401\)\{\s*merchantOfflineGuard\(true\)/,'401 must set revocation marker');
assert.match(backendSrc,/merchantRuntime\.status='no-access'/,'403 must leave driver panel inaccessible');
assert.match(backendSrc,/merchantOfflineGuard\(data\.merchant\?\.memberRole!=='driver'\)/,'only the confirmed driver role clears revoked state');

console.log('PASS: encrypted offline receipts and restricted stale-snapshot UI; no merchant/financial writes until verified server ACK.');
