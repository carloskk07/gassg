import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const src=fs.readFileSync(new URL('../js/discovery-owner.js',import.meta.url),'utf8');
const ownerA={id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',email:'a@example.invalid'};
const ownerB={id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',email:'b@example.invalid'};
const aId='11111111-1111-4111-8111-111111111111';
const bId='22222222-2222-4222-8222-222222222222';
const listing=(id,label)=>({id,vertical:'professionals',status:'draft',
 title:label,description:'Dados privados de anúncio fictício',state_code:'RS',
 city_name:'São Gabriel',whatsapp_e164:'+555599998888',photo_urls:[]});
const gate=()=>{let resolve;const promise=new Promise(r=>{resolve=r});return {promise,resolve}};
let authEvent, signOutError=null, renderCount=0;
const pendingLists=[],pendingDetails=[],pendingTransitions=[];
const client={
 auth:{
  getUser:async()=>({data:{user:ownerA},error:null}),
  onAuthStateChange(fn){authEvent=fn;return {data:{subscription:{unsubscribe(){}}}}},
  signOut:async()=>signOutError?{error:signOutError}:{error:null}
 },
 rpc(name){
  if(name==='discovery_transition_listing'){
    const p=gate();pendingTransitions.push(p);return p.promise;
  }
  assert.equal(name,'discovery_my_listings');
  const p=gate();pendingLists.push(p);return p.promise;
 },
 from(name){
  if(name==='discovery_professional_details'){
   return {select(){return {eq(){return {maybeSingle(){const p=gate();pendingDetails.push(p);return p.promise}}}}}};
  }
  if(name==='discovery_documents'){
   return {select(){return {eq(){return Promise.resolve({data:[],error:null})}}}};
  }
  throw Error('Unexpected table '+name);
 }
};
const ctx={
 console,Date,URL,URLSearchParams,Promise,location:{origin:'https://tamao.com.br',
  pathname:'/',search:'',hash:'#advertise'},
 route:()=> 'advertise',shell:x=>x,render(){renderCount++},
 esc:x=>String(x??'').replaceAll('<','&lt;'),
 CHAMA_BACKEND:{url:'https://example.invalid',publishableKey:'test'},
 chamaFetch(){},loadSupabaseBrowser:async()=>({createClient:()=>client})
};
ctx.globalThis=ctx;
vm.runInNewContext(src+';this.state=discoveryOwner;',ctx,{filename:'js/discovery-owner.js'});
const s=ctx.state;
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const release=(queue,data,error=null)=>{
 assert.ok(queue.length,'Expected waiting RPC');
 queue.shift().resolve({data,error});
};

// Establish a verified owner A using the real init and Auth callback.
const init=ctx.discoveryOwnerInit();
await flush();
release(pendingLists,[listing(aId,'Private listing A')]);
await init;
assert.equal(s.user.id,ownerA.id);
assert.equal(s.items[0].title,'Private listing A');
assert.equal(typeof authEvent,'function');

// A late response after another tab signs out cannot restore owner A's data.
const stale=ctx.discoveryOwnerRefresh();
authEvent('SIGNED_OUT',null);
assert.equal(s.user,null);
assert.equal(s.items.length,0);
assert.equal(s.editor,null);
release(pendingLists,[listing(aId,'Private listing A')]);
assert.equal(await stale,false);
assert.equal(s.items.length,0);
assert.doesNotMatch(ctx.discoveryOwnerPage(),/Private listing A/);

// Switching to B starts a fresh authorized read and never borrows A's cache.
authEvent('SIGNED_IN',{user:ownerB});
await flush();
assert.equal(s.user.id,ownerB.id);
assert.equal(s.items.length,0);
release(pendingLists,[listing(bId,'Private listing B')]);
await flush();
assert.equal(s.items[0].id,bId);
assert.doesNotMatch(ctx.discoveryOwnerPage(),/Private listing A/);

// Two reads for the SAME owner may complete out of order: latest wins.
const oldRefresh=ctx.discoveryOwnerRefresh();
const newRefresh=ctx.discoveryOwnerRefresh();
assert.equal(pendingLists.length,2);
const older=pendingLists.shift(),newer=pendingLists.shift();
newer.resolve({data:[listing(bId,'Newest B')],error:null});
assert.equal(await newRefresh,true);
older.resolve({data:[listing(bId,'Stale B')],error:null});
assert.equal(await oldRefresh,false);
assert.equal(s.items[0].title,'Newest B');

// Submission can commit server-side just before logout; a late ACK
// must not claim review success or resurrect private records in the UI.
const submission=ctx.discoveryOwnerSubmit(bId);
assert.equal(pendingTransitions.length,1);
authEvent('SIGNED_OUT',null);
release(pendingTransitions,'review');
await submission;
assert.equal(s.user,null);
assert.equal(s.items.length,0);
assert.equal(s.notice,'');
authEvent('SIGNED_IN',{user:ownerB});
await flush();
release(pendingLists,[listing(bId,'Private listing B')]);
await flush();

// The selected editor's details must not reappear after a remote logout.
const opening=ctx.discoveryOwnerOpen(bId);
assert.equal(pendingDetails.length,1);
authEvent('SIGNED_OUT',null);
release(pendingDetails,{occupation:'Mototáxi',private_field:'never show'});
await opening;
assert.equal(s.editor,null);
assert.equal(s.items.length,0);
assert.match(ctx.discoveryOwnerPage(),/Receber link de acesso/);

// A network-rejected logout must NOT pretend to have revoked the session.
authEvent('SIGNED_IN',{user:ownerB});
await flush();
release(pendingLists,[listing(bId,'Private listing B')]);
await flush();
signOutError=new Error('network lost');
assert.equal(await ctx.discoveryOwnerLogout(),false);
assert.equal(s.user.id,ownerB.id);
assert.match(s.error,/Não foi possível sair/);
signOutError=null;
assert.equal(await ctx.discoveryOwnerLogout(),true);
assert.equal(s.user,null);
assert.equal(s.items.length,0);
assert.ok(renderCount>0);
const audit=fs.readFileSync(new URL('../.github/workflows/audit.yml',import.meta.url),'utf8');
assert.ok(audit.includes('node tests/discovery-owner-auth-isolation-v1-493.mjs'));
console.log('PASS: cross-tab signout, account replacement, stale read/editor isolation and failed logout handling');
