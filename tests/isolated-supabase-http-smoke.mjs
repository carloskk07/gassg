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


// Verify authorized Admin support lifecycle using REAL local Auth, database
// and Edge. Entire stack is ephemeral; no production accounts or requests.
const localAdminActors=[];
const authAdminActor=async role=>{
  const email='ci-'+role+'-'+randomUUID()+'@example.com',password='LocalOnly!'+randomUUID();
  const create=await fetch(base+'/auth/v1/admin/users',{
    method:'POST',headers:adminHeaders,
    body:JSON.stringify({email,password,email_confirm:true}),signal:AbortSignal.timeout(30000)
  });
  assert.ok([200,201].includes(create.status),'local '+role+' user created');
  const user=await create.json(),id=user.id||user.user?.id;
  assert.match(id,/^[0-9a-f-]{36}$/i);
  localAdminActors.push(id);
  const login=await fetch(base+'/auth/v1/token?grant_type=password',{
    method:'POST',headers:{apikey:anon,'Content-Type':'application/json'},
    body:JSON.stringify({email,password}),signal:AbortSignal.timeout(30000)
  });
  assert.equal(login.status,200);
  const session=await login.json();
  assert.ok(session.access_token?.length>100);
  localSql("insert into public.platform_admins(user_id,admin_role,active) values ('"+
    id+"','"+role+"',true)");
  return session.access_token;
};
try{
  const supportToken=await authAdminActor('support');
  const financeToken=await authAdminActor('finance');
  const readonlyToken=await authAdminActor('readonly');
  // 72 older help requests + one real local Edge intake above. More recent
  // general/privacy cases must never hide pending help from the Admin.
  localSql("insert into public.public_requests("+
    "request_kind,contact_name,contact_channel,contact_value,message,"+
    "acknowledged_at,ip_hash,status,created_at) "+
    "select case when n<=72 then 'support' when n<=292 then 'general' else 'privacy' end,"+
    "'CI synthetic '||n,'email','ci-'||n||'@example.com',"+
    "'Synthetic support regression item '||n,clock_timestamp(),repeat('a',64),"+
    "case when n%3=0 then 'in_review' else 'new' end,"+
    "clock_timestamp()+(case when n<=72 then n-1000 else n end)*interval '1 second' "+
    "from generate_series(1,322) n");
  const supportCount=Number(localSql("select count(*) from public.public_requests "+
    "where request_kind='support' and status in ('new','in_review')"));
  assert.equal(supportCount,73);
  const adminReq=async(token,body,idempotencyKey=null)=>{
    const response=await fetch(base+'/functions/v1/admin-ops',{
      method:'POST',headers:{...headers,Authorization:'Bearer '+token,
        'Idempotency-Key':idempotencyKey||'ci-admin-'+randomUUID()},
      body:JSON.stringify(body),signal:AbortSignal.timeout(150000)
    });
    return {status:response.status,body:await response.json()};
  };
  // The local read-only operator cannot bypass UI menus to inspect
  // financial wallets, personal entity details or private support reports.
  const readonlyDenied=await Promise.all([
    adminReq(readonlyToken,{action:'owner-wallet-reconciliation'}),
    adminReq(readonlyToken,{action:'entity-detail',entityType:'customer',
      entityId:'00000000-0000-4000-8000-000000000000'}),
    adminReq(readonlyToken,{action:'support-reports-page',page:0}),
    adminReq(readonlyToken,{action:'merchant-payment-preflight',
      merchantId:'00000000-0000-4000-8000-000000000000'})
  ]);
  assert.ok(readonlyDenied.every(r=>r.status===403),
    'readonly role cannot access financial, personal or support endpoints');
  const readonlyAudit=await adminReq(readonlyToken,{action:'audit-search',limit:20});
  assert.equal(readonlyAudit.status,200);
  assert.ok(Array.isArray(readonlyAudit.body.results));
  assert.ok(readonlyAudit.body.results.every(row=>
    !('metadata' in row)&&!('actor_user_id' in row)&&!('target_id' in row)));
  const readonlyIncident=await adminReq(readonlyToken,{action:'incident-list'});
  assert.equal(readonlyIncident.status,200);
  assert.ok((readonlyIncident.body.incidents||[]).every(row=>
    !('description' in row)&&!('resolution_note' in row)));
  const readonlySummary=await adminReq(readonlyToken,{action:'summary'});
  assert.equal(readonlySummary.status,200,
    'readonly role must retain sanitized operational summary');
  assert.equal(readonlySummary.body.currentAdmin.admin_role,'readonly');
  assert.deepEqual(readonlySummary.body.publicRequests,[]);
  assert.deepEqual(readonlySummary.body.controlOrders,[]);
  assert.deepEqual(readonlySummary.body.prelaunchLeads,[]);
  assert.deepEqual(readonlySummary.body.merchantBilling.paymentEvents,[]);
  assert.ok(!JSON.stringify(readonlySummary.body).includes('ci-1@example.com'),
    'private synthetic request contacts never reach readonly');
  console.log('PASS local real Edge readonly: summary safe, financial and personal endpoints denied.');

  const first=await adminReq(supportToken,{action:'support-reports-page',page:0});
  assert.equal(first.status,200,'support role reads first page via real Edge');
  assert.equal(first.body.source,'admin_support_reports_page_v1');
  assert.equal(first.body.readOnly,true);
  assert.equal(first.body.total,supportCount);
  assert.equal(first.body.items.length,30);
  assert.ok(first.body.items.every(r=>r.request_kind==='support'&&
    ['new','in_review'].includes(r.status)));
  const second=await adminReq(supportToken,{action:'support-reports-page',page:1});
  assert.equal(second.status,200);
  assert.equal(second.body.items.length,30);
  assert.ok(!second.body.items.some(r=>first.body.items.some(x=>x.id===r.id)));
  const last=await adminReq(supportToken,{action:'support-reports-page',page:2});
  assert.equal(last.status,200);
  assert.equal(last.body.items.length,13);
  const denied=await adminReq(financeToken,{action:'support-reports-page',page:0});
  assert.equal(denied.status,403,'finance role cannot access support contacts');
  const malformed=await adminReq(supportToken,{action:'support-reports-page',page:-1});
  assert.equal(malformed.status,400);
  const privacyId=localSql("select id from public.public_requests "+
    "where request_kind='privacy' limit 1");
  assert.match(privacyId,/^[0-9a-f-]{36}$/i);
  const privacyEdit=await adminReq(supportToken,{
    action:'public-request-status',requestId:privacyId,
    status:'resolved',resolutionNote:'CI forbidden privacy resolution'
  });
  assert.equal(privacyEdit.status,403,'support cannot resolve privacy requests');
  const supportId=last.body.items[0].id;
  const auditCount=()=>Number(localSql(
    "select count(*) from public.platform_admin_audit where action='public-request-status'"+
    " and target_id='"+supportId+"'"));
  const beforeAudit=auditCount();
  const review=await adminReq(supportToken,{
    action:'public-request-status',requestId:supportId,status:'in_review'
  });
  assert.equal(review.status,200,'support operator can assume review');
  assert.equal(localSql("select status from public.public_requests where id='"+
    supportId+"'"),'in_review');
  const during=await adminReq(supportToken,{action:'support-reports-page',page:2});
  assert.equal(during.status,200);
  assert.equal(during.body.total,supportCount,'in_review remains pending');
  assert.ok(during.body.items.some(x=>x.id===supportId&&x.status==='in_review'));
  assert.equal(auditCount(),beforeAudit+1,'review transition must be audited');
  const resolveKey='ci-admin-resolve-'+randomUUID();
  const resolutionNote='CI support case resolved on disposable database';
  const resolvePayload={
    action:'public-request-status',requestId:supportId,status:'resolved',
    resolutionNote
  };
  const update=await adminReq(supportToken,resolvePayload,resolveKey);
  assert.equal(update.status,200,'support operator resolves help cases');
  assert.equal(update.body.status,'resolved');
  assert.equal(localSql("select status from public.public_requests where id='"+
    supportId+"'"),'resolved');
  assert.equal(localSql("select resolution_note from public.public_requests where id='"+
    supportId+"'"),resolutionNote,'resolution note must persist');
  assert.equal(localSql("select resolved_at is not null from public.public_requests where id='"+
    supportId+"'"),'t','resolution timestamp must persist');
  assert.equal(auditCount(),beforeAudit+2,'resolution must add exactly one audit event');
  const replayResolution=await adminReq(supportToken,resolvePayload,resolveKey);
  assert.equal(replayResolution.status,200,'same idempotency key must replay success');
  assert.deepEqual(replayResolution.body,update.body,
    'replayed response must match the original audit-backed resolution');
  assert.equal(auditCount(),beforeAudit+2,
    'retry after lost response must never duplicate an audit event');
  assert.notEqual(localSql("select status from public.public_requests where id='"+
    privacyId+"'"),'resolved');
  const after=await adminReq(supportToken,{action:'support-reports-page',page:2});
  assert.equal(after.status,200);
  assert.equal(after.body.total,supportCount-1);
  assert.equal(after.body.items.length,12);
  console.log('PASS local real Admin Edge: 3 support pages, finance/privacy denied, review and resolution audited, idempotent retry.');
}finally{
  // Platform audit deliberately RESTRICTs deleting actors. Only on the
  // DISPOSABLE CI database, purge those synthetic audit entries first.
  if(localAdminActors.length)localSql("delete from public.platform_admin_audit where actor_user_id in ("+
    localAdminActors.map(id=>"'"+id+"'").join(',')+")");
  for(const id of localAdminActors){
    const del=await fetch(base+'/auth/v1/admin/users/'+id,{
      method:'DELETE',headers:adminHeaders,signal:AbortSignal.timeout(30000)
    });
    assert.ok([200,204].includes(del.status),'ephemeral admin identity deleted');
  }
}

console.log('PASS local Auth login, real user Edge authorization and fictitious identity cleanup; no orders/credits.');

