import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';

// Genuine Edge HTTP + real Auth + canonical PostgreSQL migrations + Admin RPC.
// Run ONLY on the disposable CI Supabase stack. Never use production credentials.
assert.equal(process.env.CI,'true');
assert.equal(process.env.SUPABASE_ACCESS_TOKEN||'','');
assert.equal(process.env.SUPABASE_DB_PASSWORD||'','');
const raw=execFileSync('supabase',['status','-o','env'],{
  encoding:'utf8',timeout:30000,stdio:['ignore','pipe','pipe']
});
const cfg=Object.fromEntries(raw.split('\n').map(line=>{
  const match=line.match(/^([A-Z_]+)=(.*)$/);
  return match?[match[1],match[2].replace(/^["']|["']$/g,'')]:null;
}).filter(Boolean));
const base=cfg.API_URL||cfg.SUPABASE_URL||'';
const anon=cfg.ANON_KEY||cfg.SUPABASE_ANON_KEY||'';
const service=cfg.SERVICE_ROLE_KEY||cfg.SUPABASE_SERVICE_ROLE_KEY||'';
assert.match(base,/^http:\/\/(?:127\.0\.0\.1|localhost):54321\/?$/);
assert.ok(anon.length>25&&service.length>25);
const sql=query=>execFileSync('psql',[
 '--host=127.0.0.1','--port=54322','--username=postgres','--dbname=postgres',
 '--no-psqlrc','--set=ON_ERROR_STOP=1','--tuples-only','--no-align','--quiet',
 '--command='+query
],{encoding:'utf8',env:{...process.env,PGPASSWORD:'postgres'},
 timeout:60000,stdio:['ignore','pipe','pipe']}).trim();
const q=s=>"'"+String(s).replaceAll("'","''")+"'";
const safeId=id=>{
  assert.match(id,/^[a-f0-9]{8}-[a-f0-9-]{27}$/i);
  return q(id)+'::uuid';
};
const getJson=query=>JSON.parse(sql(query));
assert.equal(sql("select current_database()"),'postgres');
assert.equal(sql("select count(*) from public.public_requests"),'0',
 'the disposable test must start with no public requests');
assert.equal(sql("select count(*) from public.platform_admins"),'0',
 'never use an existing administrative account in this isolated test');
const adminHeaders={apikey:service,Authorization:'Bearer '+service,
 'Content-Type':'application/json'};
const email='isolated-support-'+randomUUID()+'@example.invalid';
const password='Isolated!'+randomUUID();
let testUserId=null;

async function requestWithColdStart(url,options={},label='edge'){
 let err;
 for(let attempt=1;attempt<=2;attempt++){
  try{
   const response=await fetch(url,{
    ...options,signal:AbortSignal.timeout(attempt===1?105000:60000)
   });
   const text=await response.text();
   let data;
   try{data=JSON.parse(text)}catch{throw Error(label+' sent invalid JSON (HTTP '+response.status+')')}
   assert.ok(![502,503,504].includes(response.status),
     label+' HTTP '+response.status+' server unavailable');
   return {response,data};
  }catch(error){
   err=error;
   if(attempt===2||!['TimeoutError','AbortError'].includes(error?.name))throw error;
   // Retry only a cold-start timeout, not a processed request that returned HTTP.
   assert.equal((await fetch(base+'/auth/v1/health',{
    signal:AbortSignal.timeout(15000)})).status,200);
  }
 }
 throw err;
}
const ip='198.51.100.77'; // reserved documentation address, never an end user
const customerOrigin='http://localhost:5173';
const adminOrigin='https://admin.tamao.com.br';
const message='Teste sintético de atendimento no ambiente descartável';
const supportKey='isolated-support-'+randomUUID();
const privacyKey='isolated-privacy-'+randomUUID();
const contact='ci@example.invalid';
const supportPayload={
 requestKind:'support',acknowledged:true,
 contactName:'Usuário Sintético CI',contactChannel:'email',contactValue:contact,
 message,website:'',
 attribution:{source:'isolated_ci',landingPath:'/?tamao_help=cliente&modulo=tracking&access_token=SECRET',
  referrer:'https://tamao.com.br/account?code=SECRET#fragment'}
};
const intake=(body,key,origin=customerOrigin)=>requestWithColdStart(
 base+'/functions/v1/submit-public-request',{
  method:'POST',
  headers:{apikey:anon,Origin:origin,'Content-Type':'application/json',
   'Idempotency-Key':key,'x-real-ip':ip},
  body:JSON.stringify(body)
 },'submit-public-request');
const adminRequest=(token,body,key=null)=>requestWithColdStart(
 base+'/functions/v1/admin-ops',{
  method:'POST',
  headers:{apikey:anon,Origin:adminOrigin,'Content-Type':'application/json',
   Authorization:'Bearer '+token,...(key?{'Idempotency-Key':key}:{})},
  body:JSON.stringify(body)
 },'admin-ops');
const getRow=key=>getJson("select row_to_json(r) from ("+
 "select id,request_kind,status,request_idempotency_key,contact_value,landing_path,referrer,"+
 "resolution_note,resolved_at from public.public_requests where request_idempotency_key="+q(key)+
 ") r");
try{
 const created=await fetch(base+'/auth/v1/admin/users',{
  method:'POST',headers:adminHeaders,
  body:JSON.stringify({email,password,email_confirm:true}),
  signal:AbortSignal.timeout(30000)
 });
 assert.ok([200,201].includes(created.status),'create isolated support account HTTP '+created.status);
 const createdUser=await created.json();
 testUserId=createdUser.id||createdUser.user?.id;
 assert.match(testUserId,/^[a-f0-9-]{36}$/i);
 sql('insert into public.platform_admins(user_id,active,admin_role) values('+
  safeId(testUserId)+",true,'support');");
 const auth=await fetch(base+'/auth/v1/token?grant_type=password',{
  method:'POST',headers:{apikey:anon,'Content-Type':'application/json'},
  body:JSON.stringify({email,password}),signal:AbortSignal.timeout(30000)
 });
 assert.equal(auth.status,200,'real disposable Auth must issue a support JWT');
 const session=await auth.json();
 assert.equal(session.user?.id,testUserId);
 const token=session.access_token;
 assert.ok(token?.length>100);
 let result=await intake(supportPayload,supportKey);
 assert.equal(result.response.status,201,
  'actual Edge handler must persist and return HTTP 201');
 assert.equal(result.data.ok,true);assert.equal(result.data.replayed,false);
 const row=getRow(supportKey);
 assert.ok(row?.id,'public request must exist in canonical PostgreSQL');
 assert.equal(result.data.protocol,row.id.slice(0,8).toUpperCase());
 assert.equal(row.status,'new');assert.equal(row.request_kind,'support');
 assert.equal(row.contact_value,contact);
 assert.equal(row.landing_path,'/?tamao_help=cliente&modulo=tracking#contact');
 assert.equal(row.referrer,'https://tamao.com.br');
 assert.doesNotMatch(JSON.stringify(row),/SECRET|access_token/);

 result=await intake(supportPayload,supportKey);
 assert.equal(result.response.status,200);
 assert.equal(result.data.replayed,true);
 assert.equal(result.data.protocol,row.id.slice(0,8).toUpperCase());
 assert.equal(sql('select count(*) from public.public_requests'),'1',
  'replayed same request must never create two rows');
 result=await intake({...supportPayload,message:message+' modificado'},supportKey);
 assert.equal(result.response.status,409);
 assert.equal(result.data.error,'IDEMPOTENCY_CONFLICT');
 assert.equal(sql('select count(*) from public.public_requests'),'1');
 result=await intake(supportPayload,'isolated-bad-origin-'+randomUUID(),
  'https://attacker.example.invalid');
 assert.equal(result.response.status,403);
 assert.equal(result.data.error,'ORIGIN_NOT_ALLOWED');
 assert.equal(sql('select count(*) from public.public_requests'),'1');

 result=await intake({...supportPayload,requestKind:'privacy',privacyAction:'access',
  attribution:{source:'isolated_ci'}},privacyKey);
 assert.equal(result.response.status,201);
 const privacy=getRow(privacyKey);
 assert.equal(privacy.request_kind,'privacy');

 // Read as a real authenticated support operator, not through service_role.
 result=await adminRequest(token,{action:'support-reports-page',page:0});
 assert.equal(result.response.status,200);
 assert.equal(result.data.source,'admin_support_reports_page_v1');
 assert.equal(result.data.readOnly,true);
 assert.equal(result.data.total,1);
 assert.equal(result.data.items.length,1);
 assert.equal(result.data.items[0].id,row.id);
 assert.equal(result.data.items[0].request_kind,'support');
 assert.doesNotMatch(JSON.stringify(result.data),new RegExp(privacy.id),
  'support role may not see private requests');

 // Even a forged POST may not resolve a privacy request as a support user.
 result=await adminRequest(token,{action:'public-request-status',
  requestId:privacy.id,status:'resolved',resolutionNote:'Não autorizar.'},
  'isolated-privacy-denied-'+randomUUID());
 assert.equal(result.response.status,403);
 assert.equal(result.data.error,'ADMIN_PERMISSION_DENIED');
 assert.equal(getRow(privacyKey).status,'new');

 const reviewKey='isolated-review-'+randomUUID();
 result=await adminRequest(token,{action:'public-request-status',
  requestId:row.id,status:'in_review'},reviewKey);
 assert.equal(result.response.status,200);
 assert.equal(result.data.status,'in_review');
 assert.equal(getRow(supportKey).status,'in_review');
 result=await adminRequest(token,{action:'support-reports-page',page:0});
 assert.equal(result.response.status,200);
 assert.equal(result.data.total,1);
 assert.equal(result.data.items[0].status,'in_review');

 const closeKey='isolated-resolve-'+randomUUID();
 const resolution='Falha de teste tratada e verificada no ambiente isolado';
 const beforeAudit=Number(sql("select count(*) from public.platform_admin_audit "+
  "where action='public-request-status' and target_id="+q(row.id)));
 result=await adminRequest(token,{action:'public-request-status',
  requestId:row.id,status:'resolved',resolutionNote:resolution},closeKey);
 assert.equal(result.response.status,200);
 assert.equal(result.data.status,'resolved');
 const resolved=getRow(supportKey);
 assert.equal(resolved.status,'resolved');
 assert.equal(resolved.resolution_note,resolution);
 assert.ok(resolved.resolved_at);
 const afterAudit=Number(sql("select count(*) from public.platform_admin_audit "+
  "where action='public-request-status' and target_id="+q(row.id)));
 assert.equal(afterAudit-beforeAudit,1,'resolution must create one audit event');

 // A lost client response must not settle the same ticket twice.
 result=await adminRequest(token,{action:'public-request-status',
  requestId:row.id,status:'resolved',resolutionNote:resolution},closeKey);
 assert.equal(result.response.status,200);
 assert.equal(result.data.status,'resolved');
 assert.equal(Number(sql("select count(*) from public.platform_admin_audit "+
  "where action='public-request-status' and target_id="+q(row.id))),afterAudit);
 result=await adminRequest(token,{action:'support-reports-page',page:0});
 assert.equal(result.response.status,200);
 assert.equal(result.data.total,0);
 assert.equal(result.data.items.length,0);
 assert.equal(sql('select count(*) from public.orders'),'0');
 console.log('PASS: disposable Supabase end-to-end POST 201, persisted support, '+
  'idempotency/conflict, privacy isolation, JWT Admin page, in_review/resolved, '+
  'audited resolution with dedup, no commercial orders.');
}finally{
 // The CI stack is discarded by workflow regardless of cleanup outcome.
 // Clean isolated synthetic data and identity as defense in depth.
 if(testUserId){
  try{
   sql('delete from public.platform_admins where user_id='+safeId(testUserId)+';');
  }catch(error){console.warn('Disposable role cleanup deferred to supabase stop');}
  try{
   await fetch(base+'/auth/v1/admin/users/'+testUserId,{
    method:'DELETE',headers:adminHeaders,signal:AbortSignal.timeout(30000)
   });
  }catch(error){console.warn('Disposable Auth cleanup deferred to supabase stop');}
 }
}
