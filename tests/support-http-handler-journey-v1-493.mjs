import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';

// Exercise the real deployed handler SOURCE in memory, rather than reimplementing
// its business decisions. No hosted credentials, identity or DB are involved.
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const raw=read('supabase/functions/submit-public-request/index.ts');
const admin=read('supabase/functions/admin-ops/index.ts');
const acq=read('js/admin-acquisition.js');
const source=raw.replace(/^import .+;\s*$/gm,'')
  .replace(/:string\|null\b/g,'')
  .replace(/:(?:unknown|number|string|Request)\b/g,'')
  .replace(/\blet body:any;/g,'let body;');
new vm.Script(source,{filename:'submit-public-request/index.ts (TS types stripped)'});

const requests=new Map();
let nextId=1,quotaEnabled=true,quotaCalls=0,dbReads=0,dbInserts=0;
let forcedDbError=false,handler=null;
const counters=()=>({dbReads,dbInserts,quotaCalls});
const diff=(before,kind)=>counters()[kind]-before[kind];
const selectRecord=key=>requests.get(key)||null;
const fixedId=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const db={
  from(name){
    assert.equal(name,'public_requests');
    const q={filters:{},insertPayload:null,
      select(){return this;},
      eq(field,value){this.filters[field]=value;return this;},
      async maybeSingle(){
        dbReads++;
        const rec=selectRecord(this.filters.request_idempotency_key);
        return {data:rec||null,error:null};
      },
      insert(row){this.insertPayload=row;return this;},
      async single(){
        dbInserts++;
        if(forcedDbError)return {data:null,error:{code:'INTERNAL',message:'SECRET_DB_ERROR'}};
        const row=this.insertPayload;
        assert.ok(row&&row.request_kind);
        if(row.request_idempotency_key&&requests.has(row.request_idempotency_key))
          return {data:null,error:{code:'23505'}};
        const record={...row,id:fixedId(nextId++),status:'new',
          created_at:'2026-10-30T03:00:00Z'};
        requests.set(row.request_idempotency_key||record.id,record);
        return {data:record,error:null};
      }
    };
    return q;
  },
  async rpc(name,args){
    assert.equal(name,'consume_prelaunch_lead_quota');
    assert.equal(args.p_action_name,'submit-public-request');
    assert.equal(args.p_limit,5);
    quotaCalls++;
    return {data:quotaEnabled?{allowed:true}:{allowed:false,retryAfterSeconds:123},
      error:null};
  }
};
const sandbox=vm.createContext({
  Deno:{
    env:{get:k=>k==='SUPABASE_URL'?'https://supabase.example.test':
      k==='SUPABASE_SECRET_KEYS'?'{"default":"fake-key-never-a-real-secret"}':null},
    serve:fn=>{handler=fn}
  },
  createClient:(_url,_key,options)=>{
    assert.equal(options.auth.persistSession,false);
    return db;
  },
  crypto:webcrypto,TextEncoder,Uint8Array,URL,URLSearchParams,
  Response,Request,Headers,Set,JSON,String,Object,Array,Number,Error,
  console:{error:()=>{}}
});
vm.runInContext(source,sandbox);
assert.equal(typeof handler,'function');

const ALLOWED='https://tamao.com.br';
function makeRequest({origin=ALLOWED,method='POST',body='{}',key='support-request-key-0001',
  contentType='application/json',headers={}}={}){
  const h=new Headers(headers);
  if(origin!==null)h.set('Origin',origin);
  if(contentType!==null)h.set('Content-Type',contentType);
  if(key!==null)h.set('Idempotency-Key',key);
  return new Request('https://supabase.example.test/functions/v1/submit-public-request',{
    method,headers:h,...(['POST','PUT','PATCH'].includes(method)?{body}: {})
  });
}
async function ask(options={}){
  const response=await handler(makeRequest(options));
  const body=await response.json().catch(()=>null);
  assert.equal(response.headers.get('cache-control'),'no-store');
  assert.equal(response.headers.get('content-type')?.includes('application/json'),true);
  return {status:response.status,body,response};
}
function noMutation(before,label){
  assert.equal(diff(before,'dbInserts'),0,label+' must not insert');
  assert.equal(diff(before,'quotaCalls'),0,label+' must not use quota');
}
const fakeBody={
  requestKind:'support',acknowledged:true,contactName:'Pessoa Fictícia',
  contactChannel:'email',contactValue:'fixture@example.invalid',
  message:'Não consigo encontrar o acompanhamento do pedido',
  website:'',
  attribution:{
    source:'site',landingPath:'/?tamao_help=revenda&modulo=merchant-orders&access_token=TOPSECRET#secret',
    referrer:'https://tamao.com.br/reset?token=TOPSECRET#session'
  }
};
const payload=x=>JSON.stringify({...fakeBody,...x});
const beforeDenied=counters();
let res=await ask({origin:null});
assert.equal(res.status,403);assert.equal(res.body.error,'ORIGIN_NOT_ALLOWED');
assert.equal(res.response.headers.get('access-control-allow-origin'),'null');
res=await ask({origin:'https://attacker.example'});
assert.equal(res.status,403);assert.equal(res.body.error,'ORIGIN_NOT_ALLOWED');
res=await ask({origin:'https://attacker.example',method:'OPTIONS'});
assert.equal(res.status,403);
res=await ask({method:'GET'});
assert.equal(res.status,405);assert.equal(res.body.error,'METHOD_NOT_ALLOWED');
res=await ask({contentType:'text/plain'});
assert.equal(res.status,415);assert.equal(res.body.error,'INVALID_CONTENT_TYPE');
res=await ask({body:'broken-json'});
assert.equal(res.status,400);assert.equal(res.body.error,'INVALID_JSON');
// Real handler previously threw on JSON null, returning a misleading 500.
// Reject every non-object body before consent, quota and database operations.
for(const invalidShape of ['null','[]','"hello"','true','42']){
  const before=counters();
  res=await ask({body:invalidShape});
  assert.equal(res.status,400,'non-object JSON must be a client error');
  assert.equal(res.body.error,'INVALID_PAYLOAD');
  noMutation(before,'invalid request shape '+invalidShape);
}
res=await ask({body:'{}'});
assert.equal(res.status,400);assert.equal(res.body.error,'ACK_REQUIRED');
res=await ask({body:payload({requestKind:'privileged'}),key:'test-invalid-kind-001'});
assert.equal(res.status,400);assert.equal(res.body.error,'INVALID_REQUEST_KIND');
res=await ask({body:payload({contactValue:'invalid'}),key:'test-invalid-contact-001'});
assert.equal(res.status,400);assert.equal(res.body.error,'INVALID_CONTACT');
res=await ask({body:payload({message:'short'}),key:'test-short-message-001'});
assert.equal(res.status,400);assert.equal(res.body.error,'MESSAGE_REQUIRED');
res=await ask({body:payload({}),key:'bad'});
assert.equal(res.status,400);assert.equal(res.body.error,'INVALID_IDEMPOTENCY_KEY');
res=await ask({body:payload({website:'BOT FILLED THE FIELD'}),key:'honeypot-safe-000001'});
assert.equal(res.status,202);assert.equal(res.body.protocol,undefined);
noMutation(beforeDenied,'malformed requests and honeypot');
const preflight=await handler(makeRequest({method:'OPTIONS'}));
assert.equal(preflight.status,200);
assert.equal(preflight.headers.get('Access-Control-Allow-Origin'),ALLOWED);
assert.match(preflight.headers.get('Access-Control-Allow-Headers'),/idempotency-key/);

const validKey='support-positive-v1-493-001';
const beforeSubmit=counters();
res=await ask({body:payload({}),key:validKey});
assert.equal(res.status,201);assert.equal(res.body.ok,true);
assert.equal(res.body.replayed,false);
assert.equal(diff(beforeSubmit,'dbInserts'),1,'one and only one stored support request');
assert.equal(diff(beforeSubmit,'quotaCalls'),1);
const record=requests.get(validKey);
assert.equal(record.status,'new');
assert.equal(record.request_kind,'support');
assert.equal(record.privacy_action,null);
assert.equal(record.contact_value,'fixture@example.invalid');
assert.equal(record.landing_path,'/?tamao_help=revenda&modulo=merchant-orders#contact');
assert.equal(record.referrer,'https://tamao.com.br');
assert.match(record.request_hash,/^[a-f0-9]{64}$/);
assert.match(record.ip_hash,/^[a-f0-9]{64}$/);
assert.equal(res.body.protocol,record.id.slice(0,8).toUpperCase());
assert.doesNotMatch(JSON.stringify(record),/TOPSECRET|session|access_token/);
const afterSubmit=counters();
res=await ask({body:payload({}),key:validKey});
assert.equal(res.status,200);assert.equal(res.body.replayed,true);
assert.equal(res.body.protocol,record.id.slice(0,8).toUpperCase());
noMutation(afterSubmit,'idempotent retry');
res=await ask({body:payload({message:'Uma descrição totalmente diferente do problema'}),key:validKey});
assert.equal(res.status,409);assert.equal(res.body.error,'IDEMPOTENCY_CONFLICT');
noMutation(afterSubmit,'idempotency key conflict');

quotaEnabled=false;
const beforeLimit=counters();
res=await ask({body:payload({contactChannel:'whatsapp',contactValue:'(55) 99999-9999'}),
  key:'support-quota-rejected-002'});
assert.equal(res.status,429);assert.equal(res.body.error,'RATE_LIMITED');
assert.equal(diff(beforeLimit,'dbInserts'),0,'rate-limited request must not insert');
quotaEnabled=true;
forcedDbError=true;
const beforeDbError=counters();
res=await ask({body:payload({}),key:'support-db-failure-0003'});
assert.equal(res.status,500);assert.equal(res.body.error,'INTERNAL_ERROR');
assert.doesNotMatch(JSON.stringify(res.body),/SECRET_DB_ERROR|TOPSECRET/);
assert.equal(diff(beforeDbError,'dbInserts'),1,'one attempted but rejected insert');
forcedDbError=false;
const beforeWhatsapp=counters();
res=await ask({body:payload({contactChannel:'whatsapp',contactValue:'(55) 99999-9999',
  attribution:{landingPath:'/?tamao_help=cliente&modulo=tracking&token=secret'}}),
  key:'support-whatsapp-000004'});
assert.equal(res.status,201);
assert.equal(diff(beforeWhatsapp,'dbInserts'),1);
const whatsapp=requests.get('support-whatsapp-000004');
assert.equal(whatsapp.contact_value,'55999999999');
assert.equal(whatsapp.landing_path,'/?tamao_help=cliente&modulo=tracking#contact');

// The real Admin page reads support records from the same public_requests table.
// It must display a pending count without leaking a privacy/general request.
const helper=(name)=>{
  const i=acq.indexOf('function '+name+'('),j=acq.indexOf('\n}',i);
  assert.ok(i>=0&&j>i,'missing Admin support '+name);
  return acq.slice(i,j+2);
};
const uiCtx=vm.createContext({
  adminHelpPager:()=>({page:0,items:null,total:null,loading:false,error:null}),
  adminPublicRequestCard:x=>'<article>'+x.id+':'+x.status+'</article>'
});
vm.runInContext(helper('adminProblemReportsSection')+
  ';this.view=adminProblemReportsSection;',uiCtx);
const supportRows=[record,whatsapp,{id:fixedId(77),request_kind:'privacy',
  status:'new',created_at:'2026-10-30T04:00:00Z'}];
let view=uiCtx.view({publicRequests:supportRows,pendingHelpReportTotal:2});
assert.match(view,/2 pendente\(s\)/);
assert.match(view,new RegExp(record.id));
assert.match(view,new RegExp(whatsapp.id));
assert.doesNotMatch(view,new RegExp(fixedId(77)));
assert.match(admin,/if\(action==="public-request-status"&&adminAccess\.admin_role==="support"\)/,
  'support operators must not close privacy records');
assert.match(admin,/admin_public_request_action/,'resolve must call existing audited RPC');
console.log('PASS: real support Edge handler HTTP validation, intake, protocol, dedup, quota, no PII in attribution, and Admin queue (isolated, no production writes).');
