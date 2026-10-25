import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const edge=read('supabase/functions/admin-auth/index.ts');
const admin=read('js/admin.js');
const start=edge.indexOf('function unverifiedLoginResponse(origin:string)');
const end=edge.indexOf('async function claimBootstrap(',start);
assert.ok(start>0&&end>start,'Existing admin-auth request handler missing');
const executable=edge.slice(start,end)
  .replace('function unverifiedLoginResponse(origin:string)','function unverifiedLoginResponse(origin)')
  .replace('async function requestLoginLink(req:Request,origin:string,body:any)',
    'async function requestLoginLink(req,origin,body)');
let mode='existing_admin',modeError=null,otpError=null,attempts=[],quotas=[],warnings=[];
const context=vm.createContext({
  SECRET_KEY:'TEST_ONLY_NOT_A_REAL_SECRET_KEY_0000000000000',
  PUBLISHABLE_KEY:'test_publishable_not_real',
  SUPABASE_URL:'https://not-real.example',
  json:(body,status,origin)=>({body,status,origin}),
  normalizeEmail:x=>String(x||'').toLowerCase(),
  sha256Hex:async()=> 'a'.repeat(64),
  clientIp:()=> '192.0.2.2',
  safeRedirect:()=> 'https://admin.tamao.com.br/?admin=1',
  enforceHashedQuota:async(_client,opts)=>{quotas.push(opts.actionName);},
  console:{error:(...args)=>warnings.push(args)},
  createClient:(_url,key)=>key==='test_publishable_not_real'
    ?{auth:{signInWithOtp:async(payload)=>{attempts.push(payload);return{error:otpError}}}}
    :{rpc:async(name)=>{assert.equal(name,'admin_login_mode');return {data:mode,error:modeError}}}
});
vm.runInContext(executable+'\nthis.requestLink=requestLoginLink;',context,{timeout:1000});
const request={headers:new Map()};
const body={email:'admin-probe@example.test',captchaToken:'z'.repeat(30),redirectTo:'https://admin.tamao.com.br'};
const run=()=>context.requestLink(request,'https://admin.tamao.com.br',body);

const sent=await run();
assert.equal(sent.status,200);
assert.equal(sent.body.ok,true);
assert.equal(sent.body.deliveryConfirmed,false);
assert.ok(sent.body.message.includes('não confirmamos'));
assert.ok(!sent.body.message.includes('será enviado'));
assert.equal(attempts.length,1,'Authorized request still attempts provider');
assert.equal(attempts[0].options.shouldCreateUser,false);

otpError={code:'over_email_send_rate_limit',status:429};
const blocked=await run();
assert.deepEqual(blocked,sent,'Provider 429 must not reveal admin email eligibility');
assert.equal(warnings.length,1,'Server should log code (not user identity)');
assert.equal(attempts.length,2);

mode='unregistered';otpError=null;
const unknown=await run();
assert.deepEqual(unknown,sent,'Unknown address must receive the same non-confirmation');
assert.equal(attempts.length,2,'Unknown address must not invoke Auth');

modeError={code:'DATABASE_BUSY'};
const dbFailure=await run();
assert.deepEqual(dbFailure,sent,'Admin eligibility RPC error must not enumerate accounts');
assert.equal(attempts.length,2);

modeError=null;mode='bootstrap_reserved';
const reserved=await run();
assert.deepEqual(reserved,sent);
assert.equal(attempts.length,3);
assert.equal(attempts[2].options.shouldCreateUser,true,'Reserved bootstrap only');

assert.ok(quotas.includes('admin-auth-request-ip'));
assert.ok(quotas.includes('admin-auth-request-email'));
assert.ok(edge.includes('captchaToken.length<20'));
assert.ok(edge.includes('originAllowed(origin)'));
assert.ok(admin.includes('A solicitação foi processada, mas a entrega do link não foi confirmada.'));
assert.ok(admin.includes('Uma confirmação nesta tela não comprova a entrega do e-mail.'));
assert.ok(!admin.includes('adminRuntime.notice?\x60<div class="notice success"'),
  'Unknown delivery cannot appear as a green success');
console.log('Admin Auth: email receipts preserve non-enumeration even on provider 429, no fictitious delivery.');
