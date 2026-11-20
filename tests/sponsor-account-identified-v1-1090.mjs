import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const ads=read('js/ads-planner.js'),welcome=read('js/welcome-bonus.js');
const signup=read('js/customer-registration-deferred.js');
const boot=read('js/bootstrap.js');
for(const [name,src] of Object.entries({ads,welcome,signup}))
 new vm.Script(src,{filename:name+'.js'});
assert.match(ads,/sponsor-account-name/);
assert.match(ads,/sponsor-account-phone/);
assert.match(ads,/sponsor-account-email/);
assert.match(ads,/sponsor-account-login-email/);
assert.match(ads,/tamaoClubSendAccess\(email,\{returnToSponsor:true\}\)/);
assert.match(ads,/liveUpgradeAccount\(email,\{fullName,phone,returnToSponsor:true\}\)/);
assert.match(welcome,/returnToSponsor\?'marca':\(returnToCheckout\?'pedido':'clube'\)/);
assert.match(signup,/returnToSponsor\?'marca':\(returnToCheckout\?'pedido':'clube'\)/);
assert.match(boot,/marca:'sponsors'/);
assert.doesNotMatch(ads,/signInAnonymously\(/);

const start=ads.indexOf('async function tamaoAdsAccountStart(');
const end=ads.indexOf('\nfunction tamaoAdsCampaignForm(',start);
assert.ok(start>0&&end>start,'The real advertiser sign-up handler exists');
const fields=new Map(Object.entries({
 'sponsor-account-name':{value:'Maria da Silva'},
 'sponsor-account-phone':{value:'(55) 99999-9999'},
 'sponsor-account-email':{value:'Maria@example.com'},
 'sponsor-account-login-email':{value:'existing@example.com'},
 'sponsor-account-register-send':{disabled:false},
 'sponsor-account-login-send':{disabled:false},
 'sponsor-account-status':{textContent:''}
}));
const calls={registered:[],logged:[],toasts:[],renders:0};
const ctx=vm.createContext({
 document:{getElementById:id=>fields.get(id)||null},
 liveUpgradeAccount:async(email,options)=>{calls.registered.push({email,options});return {pending:true}},
 tamaoClubSendAccess:async(email,options)=>{calls.logged.push({email,options});return {accessRequested:true}},
 toast:message=>{calls.toasts.push(message)},
 render:()=>{calls.renders++},String
});
vm.runInContext(ads.slice(start,end)+'\nthis.start=tamaoAdsAccountStart;',ctx);
assert.equal(await ctx.start(),true);
assert.equal(calls.registered.length,1);
assert.equal(calls.registered[0].email,'maria@example.com');
assert.equal(calls.registered[0].options.fullName,'Maria da Silva');
assert.equal(calls.registered[0].options.phone,'55999999999');
assert.equal(calls.registered[0].options.returnToSponsor,true);
assert.equal(calls.logged.length,0);
assert.equal(fields.get('sponsor-account-register-send').disabled,false);
assert.match(fields.get('sponsor-account-status').textContent,/confirmação/);
fields.get('sponsor-account-name').value='';
fields.get('sponsor-account-phone').value='';
assert.equal(await ctx.start('login'),true);
assert.equal(calls.logged.length,1);
assert.equal(calls.logged[0].email,'existing@example.com');
assert.equal(calls.logged[0].options.returnToSponsor,true);
assert.equal(calls.registered.length,1,'Existing account access must not create account');
assert.equal(fields.get('sponsor-account-login-send').disabled,false);
assert.match(fields.get('sponsor-account-status').textContent,/link de entrada/);
fields.get('sponsor-account-name').value='Maria da Silva';
fields.get('sponsor-account-phone').value='bad';
assert.equal(await ctx.start(),undefined,'Invalid DDD cannot reach Auth');
assert.equal(calls.registered.length,1,'Invalid identity must not call signup');
assert.match(calls.toasts.join(' '),/telefone com DDD/i);

const otpStart=welcome.indexOf('async function tamaoClubSendAccess(');
const otpEnd=welcome.indexOf('\nfunction tamaoWelcomeRegister(',otpStart);
assert.ok(otpStart>=0&&otpEnd>otpStart);
let realLogin=null, realSignup=null;
const auth={getSession:async()=>({data:{session:null},error:null}),
 signInWithOtp:async params=>{if(params.options.shouldCreateUser)realSignup=params;else realLogin=params;return {error:null}}};
const base={liveRuntime:{client:{auth},session:null},customerOriginSafe:()=>true,
 location:{origin:'https://tamao.com.br'},URL,String,Error,console};
base.globalThis=base;
base.chamaTurnstile={challenge:async()=> 'captcha-token-for-isolated-tests'};
vm.runInNewContext(welcome.slice(otpStart,otpEnd)+'\nthis.enter=tamaoClubSendAccess;',base);
await base.enter('existing@example.com',{returnToSponsor:true});
assert.equal(realLogin.options.shouldCreateUser,false);
assert.equal(realLogin.options.captchaToken,'captcha-token-for-isolated-tests');
assert.equal(new URL(realLogin.options.emailRedirectTo).searchParams.get('entrada'),'marca');

const regStart=signup.indexOf('async function tamaoRegisterIdentifiedAccount(');
const regEnd=signup.indexOf('\nglobalThis.tamaoRegisterIdentifiedAccount=',regStart);
assert.ok(regStart>=0&&regEnd>regStart);
base.liveRuntime.client.auth=auth;
vm.runInNewContext(signup.slice(regStart,regEnd)+'\nthis.register=tamaoRegisterIdentifiedAccount;',base);
await base.register('maria@example.com',{fullName:'Maria da Silva',phone:'55999999999',returnToSponsor:true});
assert.equal(realSignup.options.shouldCreateUser,true);
assert.equal(realSignup.options.data.full_name,'Maria da Silva');
assert.equal(realSignup.options.data.phone,'55999999999');
assert.equal(new URL(realSignup.options.emailRedirectTo).searchParams.get('entrada'),'marca');
assert.equal(realSignup.options.captchaToken,'captcha-token-for-isolated-tests');
assert.match(read('css/public-ux.css'),/sponsor-account-form-grid/);
assert.match(read('.github/workflows/audit.yml'),/tests\/sponsor-account-identified-v1-1090\.mjs/);
console.log('PASS V1.1090 advertiser: identified new account, returning OTP no ghost user, Turnstile, and safe return to sponsor campaign.');
