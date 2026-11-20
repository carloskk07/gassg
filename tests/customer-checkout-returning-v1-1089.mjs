import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const index=read('index.html');
const welcome=read('js/welcome-bonus.js');
const deferred=read('js/customer-registration-deferred.js');
const backend=read('js/backend.js');
const start=index.indexOf('<template id="tamao-checkout-identity-template">');
const end=index.indexOf('</template>',start);
assert.ok(start>=0&&end>start,'Checkout account template exists');
const markup=index.slice(start,end);
assert.match(markup,/id="tamao-checkout-identity"/);
assert.match(markup,/id="tamao-order-name"/);
assert.match(markup,/id="tamao-order-phone"/);
assert.match(markup,/id="tamao-order-email"/);
assert.match(markup,/class="tamao-checkout-returning"/);
assert.match(markup,/data-tamao-account-context="checkout-login"/);
assert.match(markup,/id="tamao-order-login-email"/);
assert.match(markup,/Já tenho conta — entrar sem sair da compra/);
assert.equal((markup.match(/onsubmit="return tamaoWelcomeRegister\(event\)"/g)||[]).length,2,
 'Register and existing-account login use the established lazy, captcha-protected handler');
assert.doesNotMatch(markup,/Já tem conta\? Entre pelo Clube/);
assert.doesNotMatch(backend,/\.auth\.signInAnonymously\s*\(/);

const signInStart=welcome.indexOf('async function tamaoClubSendAccess(');
const signInEnd=welcome.indexOf('\nfunction tamaoWelcomeRegister(event)',signInStart);
assert.ok(signInStart>=0&&signInEnd>signInStart);
let authCall=null, captchaCount=0;
const runtime={client:{auth:{signInWithOtp:async input=>{authCall=input;return {error:null};}}},session:null};
const authContext={
 liveRuntime:runtime,customerOriginSafe:()=>true,
 location:{origin:'https://tamao.com.br'},
 URL,String,Error
};
authContext.globalThis=authContext;
authContext.chamaTurnstile={challenge:async()=>{captchaCount++;return 'captcha-token-for-tests';}};
vm.runInNewContext(welcome.slice(signInStart,signInEnd)+';this.send=tamaoClubSendAccess;',authContext);
assert.equal((await authContext.send('  Conta@Example.com  ',{returnToCheckout:true})).accessRequested,true);
assert.equal(authCall.email,'conta@example.com');
assert.equal(authCall.options.shouldCreateUser,false,'Login cannot create an unknown user');
assert.equal(authCall.options.captchaToken,'captcha-token-for-tests');
assert.equal(new URL(authCall.options.emailRedirectTo).origin,'https://tamao.com.br');
assert.equal(new URL(authCall.options.emailRedirectTo).searchParams.get('entrada'),'pedido',
 'Existing buyer returns directly to the checkout route');
assert.equal((await authContext.send('conta@example.com')).accessRequested,true);
assert.equal(new URL(authCall.options.emailRedirectTo).searchParams.get('entrada'),'clube',
 'Club login keeps its previous destination');
assert.equal(captchaCount,2);

let loginCalls=[],registrationCalls=0;
const field={value:'cliente@example.com'};
const status={textContent:''};
const button={disabled:false};
const form={
 dataset:{tamaoAccountContext:'checkout-login'},
 closest:sel=>sel==='#tamao-checkout-identity'?{}:null,
 querySelector:sel=>{
  if(sel==='input[type=email]')return field;
  if(sel==='[data-welcome-signup-status]')return status;
  if(sel==='button[type=submit]')return button;
  return null;
 },
 querySelectorAll:()=>[button]
};
const handlerContext={
 String,Error,Array,
 tamaoClubSendAccess:async(email,options)=>{
  loginCalls.push({email,returnToCheckout:options.returnToCheckout});
  return {accessRequested:true};
 },
 liveUpgradeAccount:async()=>{registrationCalls++;throw Error('Login cannot register another account');}
};
handlerContext.globalThis=handlerContext;
vm.runInNewContext(deferred.slice(deferred.indexOf('async function tamaoRegisterForm(event)')),handlerContext);
const event={preventDefault(){},currentTarget:form,submitter:button};
await handlerContext.tamaoRegisterForm(event);
assert.equal(loginCalls.length,1);
assert.equal(loginCalls[0].email,'cliente@example.com');
assert.equal(loginCalls[0].returnToCheckout,true);
assert.equal(registrationCalls,0,'Existing buyer does not need name, phone or a new registration');
assert.equal(button.disabled,false);
assert.match(status.textContent,/voltar à sua cesta/);

form.dataset.tamaoAccountContext='club';
field.value='cliente@example.com';
await handlerContext.tamaoRegisterForm(event);
assert.equal(loginCalls.length,2);
assert.equal(loginCalls[1].returnToCheckout,false,'Club account flow does not change');

form.dataset.tamaoAccountContext='checkout';
field.value='novo@example.com';
await handlerContext.tamaoRegisterForm(event);
assert.equal(registrationCalls,0,'New checkout registration still requires name and phone');
assert.match(status.textContent,/nome e sobrenome/);

console.log('PASS V1.1089: existing checkout buyer logs in without Club detour, no account creation, same-cart return and existing signup guard.');
