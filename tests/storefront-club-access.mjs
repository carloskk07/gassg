import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const welcome=read('js/welcome-bonus.js'),customer=read('js/customer.js');
let ready=true,safe=true,challenge='captcha',otpError=null,resolveChallenge=null;
const requests=[],upgrades=[];
const runtime={client:{auth:{signInWithOtp:async payload=>{
 requests.push(payload);return {error:otpError};
}}},session:{user:{id:'visitor'}}};
const ctx=vm.createContext({
 document:{readyState:'loading',addEventListener(){}},URL,Intl,
 location:{origin:'https://tamao.com.br'},liveRuntime:runtime,
 liveReady:()=>ready,customerOriginSafe:()=>safe,
 chamaTurnstile:{challenge:async action=>{
  assert.equal(action,'customer_login');
  return resolveChallenge?new Promise(resolve=>{resolveChallenge=resolve}):challenge;
 }},liveUpgradeAccount:async email=>{upgrades.push(email);return {pending:true}}
});
vm.runInContext(welcome+'\nthis.api={login:tamaoClubSendAccess,submit:tamaoWelcomeRegister};',ctx);
const {login,submit}=ctx.api;
await assert.rejects(login('invalid'),/INVALID_EMAIL/);
ready=false;await assert.rejects(login('member@example.invalid'),/ACCOUNT_SERVICE_UNAVAILABLE/);
ready=true;safe=false;await assert.rejects(login('member@example.invalid'),/ACCOUNT_SERVICE_UNAVAILABLE/);
safe=true;challenge='';await assert.rejects(login('member@example.invalid'),/ACCOUNT_CONTEXT_CHANGED/);
assert.equal(requests.length,0,'No OTP request without safe origin, ready client and bot token');
challenge='captcha';resolveChallenge=true;
const stale=login('member@example.invalid');
runtime.session={user:{id:'another-user'}};
resolveChallenge('captcha');resolveChallenge=null;
await assert.rejects(stale,/ACCOUNT_CONTEXT_CHANGED/);
assert.equal(requests.length,0,'Session changes during CAPTCHA cannot send a late request');
const field={value:'  MEMBER@EXAMPLE.INVALID  '},status={textContent:''};
const buttons=[{disabled:false},{disabled:false}];
const form={dataset:{tamaoAccountContext:'club'},querySelector:q=>
 q==='input[type=email]'?field:q==='[data-welcome-signup-status]'?status:buttons[0],
 querySelectorAll:()=>buttons};
const event=value=>({preventDefault(){},currentTarget:form,submitter:{value}});
await submit(event('login'));
assert.equal(requests.length,1);
assert.equal(requests[0].email,'member@example.invalid');
assert.equal(requests[0].options.shouldCreateUser,false,'Login must never silently register a different account');
assert.equal(requests[0].options.emailRedirectTo,'https://tamao.com.br/#club');
assert.equal(requests[0].options.captchaToken,'captcha');
assert.equal(upgrades.length,0,'Existing account login must not upgrade the anonymous visitor');
assert.match(status.textContent,/Solicitamos seu link/);
assert.equal(field.value,'');assert.ok(buttons.every(b=>!b.disabled));
field.value='new@example.invalid';await submit(event('register'));
assert.deepEqual(upgrades,['new@example.invalid'],'Registration keeps the existing visitor upgrade path');
assert.equal(requests.length,1);
assert.match(status.textContent,/confirmar sua conta/);
field.value='invalid';await submit(event('login'));
assert.equal(requests.length,1);assert.match(status.textContent,/e-mail válido/);
field.value='member@example.invalid';buttons[1].disabled=true;
await submit(event('login'));assert.equal(requests.length,1,'Both buttons share the in-flight guard');
buttons[1].disabled=false;otpError=new Error('provider failure');
await submit(event('login'));assert.match(status.textContent,/Não foi possível/);
assert.ok(buttons.every(b=>!b.disabled),'A failed request can be retried');
const a=customer.indexOf('let buyerCartEditorOpen=false;');
const b=customer.indexOf('function orderPage(){',a);
assert.ok(a>=0&&b>a);
const editor=vm.createContext({});
vm.runInContext(customer.slice(a,b)+'\nthis.toggle=customerCartEditorToggle;this.open=()=>buyerCartEditorOpen;',editor);
assert.equal(editor.open(),false);
assert.equal(editor.toggle({isConnected:true,open:true}),true);
assert.equal(editor.open(),true);
assert.equal(editor.toggle({isConnected:false,open:false}),false);
assert.equal(editor.open(),true,'Detached controls cannot collapse the current product editor');
editor.toggle({isConnected:true,open:false});assert.equal(editor.open(),false);
assert.match(read('js/bootstrap.js'),/customerCartEditorToggle,/);
assert.match(read('js/growth.js'),/value="login"/);
assert.match(read('js/growth.js'),/value="register"/);
console.log('PASS: safe existing-account login, separate visitor registration, no duplicate requests and persistent cart editor.');
