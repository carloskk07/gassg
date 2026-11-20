import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const welcome=read('js/welcome-bonus.js');
const deferred=read('js/customer-registration-deferred.js');
const customer=read('js/customer.js');
let safe=true,challenge='captcha',otpError=null,resolveChallenge=null;
const requests=[],upgrades=[];
const runtime={client:{auth:{signInWithOtp:async payload=>{
 requests.push(payload);return {error:otpError};
}}},session:null};
const ctx=vm.createContext({
 document:{readyState:'loading',addEventListener(){}},URL,Intl,
 location:{origin:'https://tamao.com.br'},liveRuntime:runtime,
 liveReady:()=>false,customerOriginSafe:()=>safe,
 chamaTurnstile:{challenge:async action=>{
  assert.equal(action,'customer_login');
  return resolveChallenge?new Promise(resolve=>{resolveChallenge=resolve}):challenge;
 }},
 liveUpgradeAccount:async (email,profile)=>{
  upgrades.push({email,profile});return {pending:true};
 }
});
vm.runInContext(welcome+'\n'+deferred+
 '\nthis.api={login:tamaoClubSendAccess,submit:tamaoRegisterForm};',ctx);
// Rebind only the registration transport; browser script declares its own
// liveUpgradeAccount function, so a stub passed before evaluation is shadowed.
ctx.liveUpgradeAccount=async (email,profile)=>{upgrades.push({email,profile});return {pending:true};};
const {login,submit}=ctx.api;
await assert.rejects(login('invalid'),/INVALID_EMAIL/);
safe=false;
await assert.rejects(login('member@example.invalid'),/ACCOUNT_SERVICE_UNAVAILABLE/);
safe=true;challenge='';
await assert.rejects(login('member@example.invalid'),/ACCOUNT_CONTEXT_CHANGED/);
assert.equal(requests.length,0,'No OTP without safe origin and verified bot token');
challenge='captcha';
// A guest with NO session must be able to request an existing account login.
await login('member@example.invalid');
assert.equal(requests.length,1);
assert.equal(requests[0].options.shouldCreateUser,false,
 'Existing member login must never silently create an account');
requests.length=0;
resolveChallenge=true;
const stale=login('member@example.invalid');
runtime.session={user:{id:'switched-user'}};
resolveChallenge('captcha');resolveChallenge=null;
await assert.rejects(stale,/ACCOUNT_CONTEXT_CHANGED/);
assert.equal(requests.length,0,'Late CAPTCHA cannot log into changed account');
const field={value:'  MEMBER@EXAMPLE.INVALID  '},status={textContent:''};
const fullName={value:'Cliente Verificado',focus(){}},phone={value:'51999999999',focus(){}};
const buttons=[{disabled:false},{disabled:false}];
const form={dataset:{tamaoAccountContext:'club'},
 querySelector:q=>q==='input[type=email]'?field:
 q==='input[name="full_name"]'?fullName:
 q==='input[name="phone"]'?phone:
 q==='[data-welcome-signup-status]'?status:buttons[0],
 querySelectorAll:()=>buttons};
const event=value=>({preventDefault(){},currentTarget:form,submitter:{value}});
await submit(event('login'));
assert.equal(requests.length,1);
assert.equal(requests[0].email,'member@example.invalid');
assert.equal(requests[0].options.shouldCreateUser,false);
assert.equal(requests[0].options.emailRedirectTo,'https://tamao.com.br/?entrada=clube');
assert.equal(requests[0].options.captchaToken,'captcha');
assert.equal(upgrades.length,0,'Login does not upgrade or create a user');
assert.match(status.textContent,/Solicitamos seu link/);
assert.equal(field.value,'');assert.ok(buttons.every(b=>!b.disabled));
field.value='new@example.invalid';
await submit(event('register'));
assert.equal(upgrades.length,1);
assert.equal(upgrades[0].email,'new@example.invalid');
assert.equal(upgrades[0].profile.fullName,'Cliente Verificado');
assert.equal(upgrades[0].profile.phone,'51999999999');
assert.equal(requests.length,1,'Registration does not submit a login OTP');
assert.match(status.textContent,/confirmar sua conta/);
fullName.value='A';field.value='another@example.invalid';
await submit(event('register'));
assert.equal(upgrades.length,1,'A single-letter name is not an account');
assert.match(status.textContent,/nome e sobrenome/);
fullName.value='Cliente Verificado';phone.value='123';
await submit(event('register'));
assert.equal(upgrades.length,1,'Missing DDD must not create an account');
assert.match(status.textContent,/telefone com DDD/);
phone.value='51999999999';field.value='invalid';
await submit(event('login'));
assert.equal(requests.length,1);
assert.match(status.textContent,/e-mail válido/);
field.value='member@example.invalid';buttons[1].disabled=true;
await submit(event('login'));
assert.equal(requests.length,1,'Both submit buttons share in-flight guard');
buttons[1].disabled=false;otpError=new Error('provider failure');
await submit(event('login'));
assert.match(status.textContent,/Não foi possível/);
assert.ok(buttons.every(b=>!b.disabled),'Failed request is retryable');
assert.match(welcome,/tamaoLoadCustomerRegistration\(\)/);
assert.match(deferred,/shouldCreateUser:true/);
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
console.log('PASS: guest login, identified registration, no duplicate requests and cart editor.');
