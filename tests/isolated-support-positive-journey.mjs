import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
// Real Edge HTTP and protected Admin, ONLY the disposable Supabase CI database.
assert.equal(process.env.CI,'true');
assert.equal(process.env.SUPABASE_ACCESS_TOKEN||'','');
assert.equal(process.env.SUPABASE_DB_PASSWORD||'','');
const raw=execFileSync('supabase',['status','-o','env'],{encoding:'utf8',timeout:30000});
const vars=Object.fromEntries(raw.split('\n').map(s=>{
 const m=s.match(/^([A-Z_]+)=(.*)$/);return m?[m[1],m[2].replace(/^["']|["']$/g,'')]:null;
}).filter(Boolean));
const base=(vars.API_URL||vars.SUPABASE_URL||'').replace(/\/$/,'');
const anon=vars.ANON_KEY||vars.SUPABASE_ANON_KEY||'';
const service=vars.SERVICE_ROLE_KEY||vars.SUPABASE_SERVICE_ROLE_KEY||'';
assert.match(base,/^http:\/\/(?:127\.0\.0\.1|localhost):54321$/);
assert.ok(anon.length>25&&service.length>25);
const sql=s=>execFileSync('psql',['--host=127.0.0.1','--port=54322',
 '--username=postgres','--dbname=postgres','--no-psqlrc','--set=ON_ERROR_STOP=1',
 '--tuples-only','--no-align','--quiet','--command='+s],
 {encoding:'utf8',env:{...process.env,PGPASSWORD:'postgres'},timeout:30000}).trim();
const q=s=>"'"+String(s).replaceAll("'","''")+"'";
const headers=(key,token,origin)=>({
 apikey:anon,'Content-Type':'application/json',Origin:origin||'https://tamao.com.br',
 ...(key?{'Idempotency-Key':key}:{}),...(token?{Authorization:'Bearer '+token}:{})
});
const post=async(slug,body,key,token,origin)=>{
 const res=await fetch(base+'/functions/v1/'+slug,{method:'POST',
  headers:headers(key,token,origin),body:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
 return {status:res.status,data:await res.json()};
};
async function actor(kind){
 const email='tamao-ci-'+kind+'-'+randomUUID()+'@example.invalid';
 const password='Local!'+randomUUID();
 const created=await fetch(base+'/auth/v1/admin/users',{method:'POST',headers:{
  apikey:service,Authorization:'Bearer '+service,'Content-Type':'application/json'},
  body:JSON.stringify({email,password,email_confirm:true}),signal:AbortSignal.timeout(30000)});
 assert.ok([200,201].includes(created.status));
 const user=await created.json();
 const login=await fetch(base+'/auth/v1/token?grant_type=password',{method:'POST',
  headers:{apikey:anon,'Content-Type':'application/json'},
  body:JSON.stringify({email,password}),signal:AbortSignal.timeout(30000)});
 assert.equal(login.status,200);
 const session=await login.json();
 return {id:user.id,token:session.access_token};
}
const admin=await actor('support-admin'),outsider=await actor('outsider');
sql("INSERT INTO public.platform_admins(user_id,admin_role,active) VALUES("+
 q(admin.id)+"::uuid,'superadmin',true)");
const key='ci-support-'+randomUUID();
const body={requestKind:'support',acknowledged:true,
 contactName:'TESTE LOCAL',contactChannel:'email',
 contactValue:'qa@example.invalid',
 message:'Teste sintetico de acompanhamento de pedido.',
 website:'',attribution:{source:'isolated-ci',
 landingPath:'/?tamao_help=cliente&modulo=tracking&access_token=SECRET#secret',
 referrer:'https://tamao.com.br/reset?token=SECRET#session'}};
const before=Number(sql("SELECT count(*) FROM public.public_requests WHERE request_kind='support'"));
const created=await post('submit-public-request',body,key);
assert.equal(created.status,201,'published Edge handler against local Supabase');
assert.equal(created.data.ok,true);
const row=JSON.parse(sql("SELECT row_to_json(r)::text FROM (SELECT id,status,landing_path,referrer "+
 "FROM public.public_requests WHERE request_idempotency_key="+q(key)+") r"));
assert.equal(row.status,'new');
assert.equal(row.landing_path,'/?tamao_help=cliente&modulo=tracking#contact');
assert.equal(row.referrer,'https://tamao.com.br');
assert.equal(created.data.protocol,row.id.slice(0,8).toUpperCase());
assert.equal(Number(sql("SELECT count(*) FROM public.public_requests WHERE request_kind='support'")),before+1);
const replay=await post('submit-public-request',body,key);
assert.equal(replay.status,200);
assert.equal(replay.data.replayed,true);
const conflict=await post('submit-public-request',{...body,message:'Uma descricao diferente'},key);
assert.equal(conflict.status,409);
assert.equal(conflict.data.error,'IDEMPOTENCY_CONFLICT');
const adminPost=(a,body,key)=>post('admin-ops',body,key,a?.token,'https://admin.tamao.com.br');
const denied=await adminPost(outsider,{action:'support-reports-page',page:0});
assert.equal(denied.status,403,'outsider cannot read contact details');
const listed=await adminPost(admin,{action:'support-reports-page',page:0});
assert.equal(listed.status,200);
assert.equal(listed.data.items?.some(x=>x.id===row.id&&x.status==='new'),true);
const reviewKey='ci-review-'+randomUUID();
const review={action:'public-request-status',requestId:row.id,status:'in_review'};
assert.equal((await adminPost(admin,review,reviewKey)).status,200);
assert.equal((await adminPost(admin,review,reviewKey)).status,200,'idempotent replay');
assert.equal(sql("SELECT status FROM public.public_requests WHERE id="+q(row.id)+"::uuid"),'in_review');
const resolved=await adminPost(admin,{action:'public-request-status',requestId:row.id,
 status:'resolved',resolutionNote:'Caso sintetico concluido em ambiente descartavel.'},
 'ci-resolve-'+randomUUID());
assert.equal(resolved.status,200);
assert.equal(sql("SELECT status FROM public.public_requests WHERE id="+q(row.id)+"::uuid"),'resolved');
assert.equal(sql("SELECT count(*) FROM public.platform_admin_audit "+
 "WHERE action='public-request-status' AND target_id="+q(row.id)),'2');
const after=await adminPost(admin,{action:'support-reports-page',page:0});
assert.equal(after.status,200);
assert.equal(after.data.items?.some(x=>x.id===row.id),false,
 'resolved ticket must leave pending support queue');
assert.equal(Number(sql("SELECT count(*) FROM public.public_requests WHERE request_kind='support'")),before+1);
console.log('PASS: isolated HTTP support intake, protocol, dedup, ACL, Admin updates, audit, resolution.');
