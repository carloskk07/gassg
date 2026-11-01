import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';

// Test actual public Edge handler source with fake storage. NEVER writes a
// production lead, contact, merchant, payment, or real buyer's information.
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const raw=read('supabase/functions/capture-prelaunch-lead/index.ts');
const ui=read('js/acquisition.js');
const audit=read('.github/workflows/audit.yml');
const source=raw.replace(/^import .+;\s*$/gm,'')
  .replace(/:string\|null\b/g,'')
  .replace(/:(?:unknown|number|string|Request)\b/g,'')
  .replace(/\blet body:any;/g,'let body;')
  .replace(/\(v:any\)/g,'(v)')
  .replace(/\(v:string\)/g,'(v)');
new vm.Script(source,{filename:'capture-prelaunch-lead/index.ts (types stripped)'});

let handler=null, writes=0, calls=0, lookupCalls=0;
const admin={
  async rpc(name,args){
    assert.equal(name,'capture_prelaunch_lead_idempotent');
    assert.ok(['customer','merchant'].includes(args.p_lead_type));
    assert.match(args.p_ip_hash,/^[a-f0-9]{64}$/);
    calls++;
    return {data:{leadId:null,leadType:args.p_lead_type,reused:false,replayed:false},
      error:null};
  },
  from(){writes++;throw new Error('must not write synthetic business rows')}
};
const ctx=vm.createContext({
  Deno:{env:{get:key=>({
    SUPABASE_URL:'https://supabase.example.invalid',
    SUPABASE_SECRET_KEYS:'{"default":"fake-secret-used-for-isolated-tests"}'
  })[key]||null},serve:fn=>{handler=fn}},
  createClient:(_url,_key,options)=>{
    assert.equal(options.auth.persistSession,false);return admin;
  },
  crypto:webcrypto,TextEncoder,Uint8Array,URL,URLSearchParams,
  Request,Response,Headers,Set,Number,Error,
  AbortController,setTimeout,clearTimeout,
  fetch:async()=>{lookupCalls++;return {ok:false}},
  console:{error:()=>{},warn:()=>{}}
});
vm.runInContext(source,ctx);
assert.equal(typeof handler,'function');

async function post(body,key='ci-lead-handler-493-001'){
 const response=await handler(new Request(
  'https://supabase.example.invalid/functions/v1/capture-prelaunch-lead',
  {method:'POST',headers:{Origin:'https://tamao.com.br',
   'Content-Type':'application/json','Idempotency-Key':key},
   body:typeof body==='string'?body:JSON.stringify(body)}));
 return {status:response.status,body:await response.json()};
}
for(const malformed of ['null','[]','"text"','true','42']){
 const before=calls;
 const res=await post(malformed);
 assert.equal(res.status,400);
 assert.equal(res.body.error,'INVALID_PAYLOAD');
 assert.equal(calls,before,'malformed body must not reach the DB');
}
assert.equal((await post('malformed-json')).body.error,'INVALID_JSON');
const merchant={leadType:'merchant',businessName:'Comércio Fictício',
  phone:'55999990000',consent:true,interests:[],website:''};
let r=await post(merchant,'ci-merchant-intake-493');
assert.equal(r.status,201);
assert.equal(r.body.accepted,true);
assert.match(r.body.message,/Contato recebido/);
assert.doesNotMatch(r.body.message,/piloto|pré-lançamento|lista de abertura/i);
const customer={leadType:'customer',phone:'55999990000',postalCode:'97300000',
  interests:['gas'],consent:true,website:''};
r=await post(customer,'ci-customer-intake-493');
assert.equal(r.status,201);
assert.match(r.body.message,/CEP/);
assert.doesNotMatch(r.body.message,/lista de abertura|pré-lançamento/i);
assert.equal(calls,2,'only two valid isolated RPC calls');
assert.equal(writes,0,'no real or synthetic production rows');
assert.equal(lookupCalls,1,'only a customer postal code triggers geography lookup');
r=await post({...merchant,consent:false},'ci-no-consent-493');
assert.equal(r.status,400);
assert.equal(r.body.error,'CONSENT_REQUIRED');
assert.doesNotMatch(r.body.message,/lista/i);

// Successful submissions may be repeated explicitly for another company
// or updated interests, while privacy consent and server dedup remain.
const a=ui.indexOf('function reopenPrelaunchLead(type){');
const b=ui.indexOf('\nfunction leadCheckedValues(',a);
assert.ok(a>=0&&b>a);
const store=new Map([['tamao-prelaunch-merchant-sent-v1','1'],
  ['tamao-prelaunch-customer-sent-v1','97300000']]);
let renders=0;
const browser=vm.createContext({
  localStorage:{
    getItem:key=>store.get(key)||null,
    removeItem:key=>store.delete(key)
  },render:()=>{renders++}
});
vm.runInContext(ui.slice(a,b)+';this.reopen=reopenPrelaunchLead;',browser);
browser.reopen('merchant');
assert.equal(store.has('tamao-prelaunch-merchant-sent-v1'),false);
assert.equal(store.get('tamao-prelaunch-customer-sent-v1'),'97300000');
browser.reopen('customer');
assert.equal(store.has('tamao-prelaunch-customer-sent-v1'),false);
browser.reopen('admin');
assert.equal(renders,2,'never change state on unknown lead types');
assert.match(ui,/reopenPrelaunchLead\(\\'merchant\\'\)/);
assert.match(ui,/reopenPrelaunchLead\(\\'customer\\'\)/);
assert.match(ui,/if\(!consent\)return prelaunchMerchantFieldError/);
assert.match(ui,/if\(!consent\)return toast/);
assert.ok(audit.includes('node tests/commercial-lead-repeat-and-handler-v1-493.mjs'));
console.log('PASS #493: commercial leads return operational copy, reject invalid JSON, and support repeat consented submissions.');
