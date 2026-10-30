import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';

// Real localhost Auth / gateway / Edge test only; fictitious local identity only,
// no provider credentials and no remote API calls.
assert.equal(process.env.CI,'true');
assert.equal(process.env.SUPABASE_ACCESS_TOKEN||'','');
assert.equal(process.env.SUPABASE_DB_PASSWORD||'','');
const output=execFileSync('supabase',['status','-o','env'],{
  encoding:'utf8',timeout:30000,stdio:['ignore','pipe','pipe']
});
const env=Object.fromEntries(output.split('\n').map(line=>{
  const m=line.match(/^([A-Z_]+)=(.*)$/);
  return m?[m[1],m[2].replace(/^["']|["']$/g,'')]:null;
}).filter(Boolean));
const base=env.API_URL||env.SUPABASE_URL||'';
const anon=env.ANON_KEY||env.SUPABASE_ANON_KEY||'';
assert.match(base,/^http:\/\/(?:127\.0\.0\.1|localhost):54321\/?$/);
assert.ok(anon.length>25,'local Supabase anon key missing');
const headers={
  apikey:anon,
  Authorization:'Bearer '+anon,
  Origin:'http://localhost:5173',
  'Content-Type':'application/json'
};
const health=await fetch(base+'/auth/v1/health',{signal:AbortSignal.timeout(25000)});
assert.equal(health.status,200,'local Auth health must be available');
for(const slug of ['create-order','merchant-orders','get-order']){
  let res;
  // GitHub's ephemeral Deno edge-runtime sometimes takes >45s to compile
  // its FIRST endpoint after 200+ Postgres migrations. We can retry a
  // transport timeout ONLY after local Auth health responds. Never treat
  // a timeout/502 or a mock as authorization success: the real endpoint
  // must still return exactly HTTP 401 and its own UNAUTHORIZED code.
  for(let attempt=1;attempt<=2;attempt++){
    try{
      res=await fetch(base+'/functions/v1/'+slug,{
        method:'POST',headers,
        body:JSON.stringify({quoteId:'00000000-0000-4000-8000-000000000001'}),
        signal:AbortSignal.timeout(attempt===1?105000:60000)
      });
      break;
    }catch(e){
      if(attempt===2||e?.name!=='TimeoutError')throw e;
      const healthAgain=await fetch(base+'/auth/v1/health',{
        signal:AbortSignal.timeout(15000)
      });
      assert.equal(healthAgain.status,200,
        'local Auth must stay healthy before retrying an Edge cold start');
      console.warn('Local disposable Edge cold-start timeout for '+slug+
        '; retrying the actual authenticated-negative HTTP probe once.');
    }
  }
  assert.ok(res,'Edge endpoint must actually reply');
  const body=await res.json();
  assert.equal(res.status,401,slug+' must deny use of anon JWT as a user session');
  assert.equal(body.error,'UNAUTHORIZED',
    slug+' must execute its OWN auth.getUser guard rather than a generic gateway error');
}

const service=env.SERVICE_ROLE_KEY||env.SUPABASE_SERVICE_ROLE_KEY||'';
assert.ok(service.length>25,'local-only service key required to create test identity');
const {randomUUID}=await import('node:crypto');
const email='ci-'+randomUUID()+'@example.com';
const password='LocalOnly!'+randomUUID();
const adminHeaders={apikey:service,Authorization:'Bearer '+service,'Content-Type':'application/json'};
let uid=null;
try{
  const create=await fetch(base+'/auth/v1/admin/users',{
    method:'POST',headers:adminHeaders,
    body:JSON.stringify({email,password,email_confirm:true}),
    signal:AbortSignal.timeout(30000)
  });
  assert.ok(create.status===200||create.status===201,
    'local auth admin must create the fictitious user; HTTP '+create.status);
  const created=await create.json();
  uid=created.id||created.user?.id;
  assert.match(uid,/^[0-9a-f-]{36}$/i);
  const login=await fetch(base+'/auth/v1/token?grant_type=password',{
    method:'POST',
    headers:{apikey:anon,'Content-Type':'application/json'},
    body:JSON.stringify({email,password}),
    signal:AbortSignal.timeout(30000)
  });
  assert.equal(login.status,200,'local Auth must issue a real user session');
  const session=await login.json();
  assert.ok(session.access_token?.length>100);
  assert.equal(session.user?.id,uid);
  const userHeaders={...headers,Authorization:'Bearer '+session.access_token};
  const probes=[
    {slug:'create-order',body:{quoteId:'not-a-uuid'},code:400,error:'INVALID_QUOTE',
     extra:{'Idempotency-Key':'isolated-user-valid-key-001'}},
    {slug:'get-order',body:{orderId:'00000000-0000-4000-8000-000000000003'},
     code:404,error:'ORDER_NOT_FOUND'},
    {slug:'merchant-orders',body:{},code:403,error:'NO_MERCHANT_ACCESS'}
  ];
  for(const probe of probes){
    const res=await fetch(base+'/functions/v1/'+probe.slug,{
      method:'POST',
      headers:{...userHeaders,...probe.extra},
      body:JSON.stringify(probe.body),
      signal:AbortSignal.timeout(45000)
    });
    const reply=await res.json();
    assert.equal(res.status,probe.code,
      probe.slug+' must enforce business authorization for a real user session');
    assert.equal(reply.error,probe.error,
      probe.slug+' must return the intended business error, not a gateway failure');
  }
}finally{
  if(uid){
    const del=await fetch(base+'/auth/v1/admin/users/'+uid,{
      method:'DELETE',headers:adminHeaders,signal:AbortSignal.timeout(30000)
    });
    assert.ok(del.status===200||del.status===204,
      'local test identity must be deleted');
  }
}
const localSql=command=>execFileSync('psql',[
  '--host=127.0.0.1','--port=54322','--username=postgres','--dbname=postgres',
  '--no-psqlrc','--set=ON_ERROR_STOP=1','--tuples-only','--no-align','--quiet','--command='+command
],{encoding:'utf8',env:{...process.env,PGPASSWORD:'postgres'},timeout:15000}).trim();
assert.equal(localSql('select count(*) from public.orders'),'0');
assert.equal(localSql('select count(*) from public.wallet_entries'),'0');
assert.equal(localSql("select count(*) from auth.users where id='"+uid+"'"),'0');

// Real local support intake: one report, same-key replay, protected URL
// attribution and no new case on conflict. The whole database is destroyed.
const reportKey='ci-support-'+randomUUID();
const reportBody={
  requestKind:'support',contactName:'Teste descartável CI',
  contactChannel:'email',contactValue:'qa@example.com',
  message:'Teste de regressão isolado: falha de acompanhamento de pedido',
  acknowledged:true,website:'',
  attribution:{
    landingPath:'/?tamao_help=revenda&modulo=merchant-orders&access_token=PRIVATE#secret',
    referrer:'https://example.com/redirect?token=PRIVATE'
  }
};
const sendSupport=async(body,key=reportKey,origin=headers.Origin)=>{
  const res=await fetch(base+'/functions/v1/submit-public-request',{
    method:'POST',headers:{...headers,Origin:origin,'Idempotency-Key':key},
    body:JSON.stringify(body),signal:AbortSignal.timeout(60000)
  });
  return {status:res.status,reply:await res.json()};
};
const submitted=await sendSupport(reportBody);
assert.equal(submitted.status,201,'real disposable support Edge must persist case');
assert.match(submitted.reply.protocol,/^[A-F0-9]{8}$/);
const replay=await sendSupport(reportBody);
assert.equal(replay.status,200,'same request key returns previous receipt');
assert.equal(replay.reply.protocol,submitted.reply.protocol,'replay must keep original protocol');
assert.equal(replay.reply.replayed,true);
const conflicting=await sendSupport({...reportBody,message:'Outra descrição do mesmo erro'});
assert.equal(conflicting.status,409,'same key with different content is rejected');
assert.equal(conflicting.reply.error,'IDEMPOTENCY_CONFLICT');
const denied=await sendSupport(reportBody,'ci-denied-'+randomUUID(),'https://other.example');
assert.equal(denied.status,403,'external origin must not submit reports');
assert.equal(denied.reply.error,'ORIGIN_NOT_ALLOWED');
const row=localSql("select landing_path||'|'||referrer from public.public_requests where request_idempotency_key='"+reportKey+"'");
assert.equal(row,'/?tamao_help=revenda&modulo=merchant-orders#contact|https://example.com');
assert.equal(localSql("select count(*) from public.public_requests where request_idempotency_key='"+reportKey+"'"),'1');
console.log('PASS local real Edge support intake, one protocol/replay, CORS denial, no token leakage or duplicate.');

console.log('PASS local Auth login, real user Edge authorization and fictitious identity cleanup; no orders/credits.');

