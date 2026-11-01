import './merchant-business-approved-draft.mjs'; // Same-owner approved-application prefill regression; Audit already invokes this suite.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {writePublicLandingPages} from '../scripts/build-public-landing-pages.mjs';

const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const bootstrap=read('js/bootstrap.js'),backend=read('js/backend.js');
const growth=read('js/growth.js'),css=read('css/marketing-premium.css');
const merchantUi=read('js/merchant.js');
new vm.Script(bootstrap,{filename:'bootstrap.js'});
new vm.Script(backend,{filename:'backend.js'});
new vm.Script(growth,{filename:'growth.js'});
const a=bootstrap.indexOf('function tamaoPublicEntryIntent(){');
const b=bootstrap.indexOf('let renderLock=false;',a);
assert.ok(a>=0&&b>a);
const routeHelpers=bootstrap.slice(a,b);
function entry(query,{hash='',origin='https://parceiro.tamao.com.br',flags={}}={}){
 const location={search:query,hash};
 let route='',submitted=0,signup=false;
 const ctx=vm.createContext({
   location,URLSearchParams,
   go:next=>{route=next;location.hash='#'+next;},
   openMerchantPortal:value=>{submitted++;signup=value;},
   buildPortalHref:value=>/^https:\/\//.test(String(value||''))?String(value):null,
   globalThis:{
     CHAMA_MERCHANT_ORIGIN:origin,
     adminPortalRequested:()=>Boolean(flags.admin),
     merchantPortalRequested:()=>Boolean(flags.merchant),
     __CHAMA_TEST__:Boolean(flags.test),CHAMA_INTERNAL_PILOT:Boolean(flags.internal)
   }
 });
 vm.runInContext(routeHelpers+';this.intent=tamaoPublicEntryIntent;this.enter=tamaoPublicEntryRoute;',ctx);
 const intent=ctx.intent(),handled=ctx.enter();
 return {intent,handled,route,submitted,signup,repeat:()=>{ctx.enter();return submitted;}};
}
const visitor=entry('?entrada=cadastro-revenda&ref=ABCDE1&utm_campaign=parceiros');
assert.equal(visitor.intent,'cadastro-revenda');
assert.equal(visitor.handled,true);
assert.equal(visitor.submitted,1);
assert.equal(visitor.signup,true);
assert.equal(visitor.repeat(),1,'DOMContentLoaded and load cannot redirect twice');
const invalidOrigin=entry('?entrada=cadastro-revenda',{origin:'javascript:alert(1)'});
assert.equal(invalidOrigin.route,'merchants','invalid portal destination must fall back safely');
const fallback=entry('?entrada=cadastro-revenda',{origin:''});
assert.equal(fallback.submitted,0);
assert.equal(fallback.route,'merchants','missing merchant origin must not strand a visitor');
assert.equal(entry('?entrada=cadastro-revenda',{hash:'#home'}).submitted,0);
for(const kind of ['admin','merchant','test','internal'])
 assert.equal(entry('?entrada=cadastro-revenda',{flags:{[kind]:true}}).submitted,0);
assert.equal(entry('?entrada=revenda').route,'merchants','legacy marketing links must stay valid');
assert.equal(entry('?entrada=admin').handled,false);

const st=backend.indexOf('function openMerchantPortal(signup=false){');
const en=backend.indexOf('\nfunction openCustomerPortal(){',st);
assert.ok(st>=0&&en>st);
const portalFn=backend.slice(st,en);
function portal(signup,ref){
 const location={href:'https://tamao.com.br/'};
 const ctx=vm.createContext({
  globalThis:{CHAMA_MERCHANT_ORIGIN:'https://parceiro.tamao.com.br'},
  location,URL,
  buildPortalHref:()=> 'https://parceiro.tamao.com.br/',
  growthAttributionCode:()=>ref,
  toast:()=>{throw new Error('Must not fallback for configured portal')}
 });
 vm.runInContext(portalFn+';this.open=openMerchantPortal;',ctx);
 ctx.open(signup);
 return new URL(location.href);
}
const signup=portal(true,'ABCDE1');
assert.equal(signup.origin,'https://parceiro.tamao.com.br');
assert.equal(signup.hash,'#merchant-join');
assert.equal(signup.searchParams.get('ref'),'ABCDE1');
const existing=portal(false,'ABCDE1');
assert.equal(existing.hash,'','existing partner cannot be sent to join by campaign attribution');
assert.equal(existing.searchParams.get('ref'),'ABCDE1','referral attribution survives without hijacking existing partner route');
const noRef=portal(true,'bad');
assert.equal(noRef.hash,'#merchant-join');
assert.equal(noRef.searchParams.has('ref'),false);
assert.ok(merchantUi.includes("signupEntry?'Cadastre sua revenda no TAMÃO'") &&
 merchantUi.includes("signupEntry?'Continuar meu cadastro →'"),
 'signup visitors must see onboarding, not existing-partner login copy');
assert.ok(growth.includes('class="primary merchant-live-signup-cta"'));
const merchantLanding=growth.slice(growth.indexOf('function merchantsLanding(){'),
 growth.indexOf('\nfunction merchantJoin(){'));
assert.ok(merchantLanding.includes('class="secondary merchant-share"'),
 'merchants can invite a second business directly from the registration section');
assert.equal((merchantLanding.match(/shareTamaoGrowthInvite\('merchant'\)/g)||[]).length,1,
 'reuse the single existing share flow without duplicate invitations');
assert.ok(merchantLanding.indexOf("openMerchantPortal(true)")<
 merchantLanding.indexOf("shareTamaoGrowthInvite('merchant')"),
 'merchant sign-up remains the primary conversion action');

// Commercial acquisition must lead to the REAL registration, not a
// simulator. The isolated GH Pages demo remains available privately for QA.
assert.ok(!['merchant-demo-link','merchant-demo-note','carloskk07.github.io/gassg'].some(
 marker=>merchantLanding.includes(marker)),
 'the live merchant landing must not present a simulator as the commercial service');
assert.match(merchantLanding,/openMerchantPortal\\(true\\)/,
 'the existing authenticated commercial signup remains the primary CTA');
const demoRuntime=read('js/runtime-config.js');
const backendSource=read('js/backend.js');
assert.match(demoRuntime,/chamaHost==='carloskk07.github.io'/);
assert.match(demoRuntime,/globalThis\.__CHAMA_TEST__=true/,
 'the GH Pages pilot must use the same isolated local simulator flags');
assert.match(backendSource,/requested:globalThis\.__CHAMA_TEST__===true\s*\? false/,
 'isolated pilot must not activate the live customer backend');

assert.match(css,/\.merchant-conversion-intro>.merchant-share:focus-visible/,
 'keyboard focus stays visible on both CTAs');
assert.match(css,/@media\(max-width:620px\)\{\.merchant-conversion-intro/,
 'sharing and signup use responsive full-width controls on mobile');
const startInvite=growth.indexOf('function tamaoGrowthInviteUrl(');
const endInvite=growth.indexOf('\nasync function shareTamaoGrowthInvite(',startInvite);
assert.ok(startInvite>=0&&endInvite>startInvite);
const invites=vm.createContext({state:{user:{referralCode:'ABCDE1'}},encodeURIComponent});
vm.runInContext(growth.slice(startInvite,endInvite)+';this.invite=tamaoGrowthInviteUrl;',invites);
assert.equal(invites.invite('merchant'),'https://tamao.com.br/?ref=ABCDE1#merchants',
 'merchant share enters the existing landing with attributable signup');
invites.state.user.referralCode='';
assert.equal(invites.invite('merchant'),'https://tamao.com.br/#merchants',
 'visitors may share the merchant entry without signing in or inventing referral codes');

assert.ok(growth.includes('class="merchant-secondary-lead" open'),
 'visible two-field contact must be expanded on first visit');
assert.ok(growth.includes('Quero anunciar meu comércio com nome e WhatsApp'),
 'visitor sees the low-friction advertising entry');
assert.ok(growth.includes('openMerchantPortal(true)'),
 'the complete authenticated signup remains available');
assert.equal((growth.slice(growth.indexOf('function merchantsLanding(){'),
  growth.indexOf('\nfunction merchantJoin(){')).match(/prelaunchMerchantLeadSection\(\)/g)||[]).length,1);
assert.ok(css.includes('.merchant-secondary-lead>summary:focus-visible'));
assert.ok(css.includes('@media(max-width:620px)'));
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tamao-direct-onboarding-'));
try{
 writePublicLandingPages(dir,{origin:'https://tamao.com.br',indexing:true});
 const page=fs.readFileSync(path.join(dir,'para-revendas','index.html'),'utf8');
 assert.match(page,/href="\/\?entrada=cadastro-revenda"/);
 assert.match(page,/href="\/#merchants"/,'marketing explanation remains available');
 assert.ok((page.match(/entrada=cadastro-revenda/g)||[]).length>=2);
 assert.doesNotMatch(page,/vendas garantidas|clientes garantidos/i);
}finally{fs.rmSync(dir,{recursive:true,force:true})}
assert.ok(read('supabase/migrations/20261014001000_clube_coupon_finance_preview_v1_239.sql')
  .includes('sales_enabled = false'),'financial claims cannot be activated by marketing redirects');
// The email magic link must retain the intent to CREATE A NEW REVENDA,
// including accounts without a pilot/prospect invitation.
const loginStart=backend.indexOf('async function merchantSendLogin(email){');
const loginEnd=backend.indexOf('\nasync function merchantSignOut(){',loginStart);
assert.ok(loginStart>=0&&loginEnd>loginStart);
const otpSrc=backend.slice(loginStart,loginEnd);
async function otpRedirect(fromRoute){
 let redirect='',renders=0;
 const fake={client:{auth:{signInWithOtp:async({options})=>{
  redirect=options.emailRedirectTo;return {error:null};
 }}},status:'unauthenticated',notice:null};
 const ctx=vm.createContext({
  merchantRuntime:fake,
  merchantBackendInit:async()=>true,
  merchantPilotInviteToken:()=>'',route:()=>fromRoute,
  location:{origin:'https://parceiro.tamao.com.br',pathname:'/'},
  URL,
  globalThis:{chamaTurnstile:{challenge:async()=> 'test-token'}},
  render:()=>{renders++;}
 });
 vm.runInContext(otpSrc+';this.login=merchantSendLogin;',ctx);
 await ctx.login('parceiro@example.com');
 assert.equal(renders,1);
 return new URL(redirect);
}
const fromSignup=await otpRedirect('merchant-join');
assert.equal(fromSignup.searchParams.get('merchant'),'1');
assert.equal(fromSignup.searchParams.get('signup'),'1',
 'new-partner intent survives across mail link');
assert.equal(fromSignup.hash,'','auth token fragment must remain available');
const fromLogin=await otpRedirect('merchant');
assert.equal(fromLogin.searchParams.has('signup'),false,
 'existing-partner login must not start signup');

// Simulate the post-OTP portal selection, after merchantBackendInit sees no
// existing merchant membership. No invite must be required to resume signup.
const afterLoadStart=bootstrap.indexOf('    const invitedPartner=Boolean(',
 bootstrap.indexOf("window.addEventListener('load'"));
const afterLoadEnd=bootstrap.indexOf('    render();',afterLoadStart);
assert.ok(afterLoadStart>=0&&afterLoadEnd>afterLoadStart);
const afterLoad=bootstrap.slice(afterLoadStart,afterLoadEnd);
function resume(search,status,invite=false){
 let current='home',routed=null;
 const ctx=vm.createContext({
  location:{search},URLSearchParams,
  route:()=>current,go:next=>{current=next;routed=next;},
  globalThis:{
   merchantRuntime:{status},
   merchantPilotInviteToken:()=>invite?'invite':'',
   merchantProspectInviteToken:()=> ''
  }
 });
 vm.runInContext(afterLoad,ctx);
 return routed;
}
assert.equal(resume('?merchant=1&signup=1','no-access'),'merchant-join');
assert.equal(resume('?merchant=1','no-access'),'merchant');
assert.equal(resume('?merchant=1&signup=1','ready'),'merchant',
 'returning owner with full access stays on their real panel');
assert.equal(resume('?merchant=1','no-access',true),'merchant-join',
 'existing valid pilot invitations still work');

// The real partner portal must never display an editable company form while
// the authenticated account or its existing applications cannot be checked.
const joinStart=growth.indexOf('function merchantJoin(){');
const joinEnd=growth.indexOf('\nfunction onlyDigits(',joinStart);
assert.ok(joinStart>=0&&joinEnd>joinStart,'find partner registration view');
const joinSource=growth.slice(joinStart,joinEnd);
function guardedJoin(status,applicationFetchError=null){
 const ctx=vm.createContext({
  globalThis:{merchantPortalRequested:()=>true,
   merchantRuntime:{status,applicationFetchError}},
  shell:html=>html,
  merchantLiveLoginView:()=> 'LOGIN',
  merchantLivePage:()=> 'ORIGIN_BLOCKED',
 });
 vm.runInContext(joinSource+';this.join=merchantJoin;',ctx);
 return ctx.join();
}
assert.equal(guardedJoin('unsafe-origin'),'ORIGIN_BLOCKED');
for(const [status,appError] of [['unavailable',null],['no-access','NETWORK_ERROR']]){
 const page=guardedJoin(status,appError);
 assert.match(page,/Tentar novamente com segurança/);
 assert.match(page,/role="alert"/);
 assert.doesNotMatch(page,/merchant-join-form|joinMerchant\(\)/,
  'fail-closed for unavailable account/application verification');
}
assert.equal(guardedJoin('unauthenticated'),'LOGIN');


// One owner may submit several distinct CNPJs; changing the selected
// application must not silently overwrite the first company's draft.
const companyBegin=growth.indexOf('function merchantPickOwnApplicationFromUi(');
assert.ok(companyBegin>=0);
const companySource=growth.slice(companyBegin,joinEnd);
const applications=[
 {id:'app-a',company_name:'Empresa Alfa',cnpj:'12345678000190',status:'pending',responsible_name:'Ana',phone:'55999998888',address_text:'Rua A'},
 {id:'app-b',company_name:'Empresa Beta',cnpj:'22345678000190',status:'approved',responsible_name:'Beto',phone:'55999997777',address_text:'Rua B'}
];
const merchantState={
 status:'no-access',session:{access_token:'test-session'},ownApplications:applications,
 selectedApplicationId:null,newApplicationMode:false
};
let companyRenders=0;
const companyCtx=vm.createContext({
 globalThis:{
   merchantPortalRequested:()=>true,merchantRuntime:merchantState,
   merchantOwnApplicationForInvite:()=>applications.find(a=>a.id===merchantState.selectedApplicationId)||applications[0],
   __CHAMA_TEST__:false
 },
 shell:html=>html,
 esc:value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])),
 render:()=>{companyRenders++},
 currentMerchantProspectInviteToken:()=>'',currentMerchantPilotInviteToken:()=>'',growthAttributionCode:()=>'',
 route:()=> 'merchant-join'
});
vm.runInContext(companySource+';this.join=merchantJoin;this.pick=merchantPickOwnApplicationFromUi;',companyCtx);
let listing=companyCtx.join();
assert.match(listing,/Escolha a empresa/);
assert.match(listing,/Empresa Alfa/);
assert.match(listing,/Empresa Beta/);
assert.match(listing,/value="12345678000190"/);
companyCtx.pick('__new__');
listing=companyCtx.join();
assert.equal(merchantState.newApplicationMode,true);
assert.match(listing,/value="__new__" selected/);
assert.doesNotMatch(listing,/value="12345678000190"/);
assert.match(listing,/Enviar cadastro da minha empresa/);
companyCtx.pick('app-b');
listing=companyCtx.join();
assert.equal(merchantState.selectedApplicationId,'app-b');
assert.match(listing,/value="22345678000190"/);
assert.match(listing,/Empresa já aprovada/);
companyCtx.pick('not-my-company');
assert.equal(merchantState.selectedApplicationId,'app-b',
 'unowned company IDs must not be selected');
assert.equal(companyRenders,2);
const ownFnStart=backend.indexOf('function merchantOwnApplicationForInvite(){');
const ownFnEnd=backend.indexOf('\nasync function merchantSendLogin(',ownFnStart);
assert.ok(ownFnStart>=0&&ownFnEnd>ownFnStart);
const ownCtx=vm.createContext({
 merchantRuntime:{ownApplications:applications,selectedApplicationId:'app-b'},
 globalThis:{merchantProspectInviteDetails:()=>null}
});
vm.runInContext(backend.slice(ownFnStart,ownFnEnd)+';this.own=merchantOwnApplicationForInvite;',ownCtx);
assert.equal(ownCtx.own().id,'app-b','owner selection must use only their own list');
ownCtx.merchantRuntime.selectedApplicationId='unowned-id';
assert.equal(ownCtx.own().id,'app-a','forged selection must fall back to own first application');
ownCtx.globalThis.merchantProspectInviteDetails=()=>({cnpj:'22345678000190'});
assert.equal(ownCtx.own().id,'app-b','verified prospect invite match overrides previous selector');
assert.ok(backend.includes('merchantRuntime.selectedApplicationId')&&
 backend.includes('merchantRuntime.newApplicationMode=false'),
 'the selected application must be reset on logout');
assert.ok(bootstrap.includes('merchantPickOwnApplicationFromUi'),
 'existing company selector must be wired in the merchant portal');
const merchantLive=read('js/merchant.js');
assert.match(merchantLive,/const anotherCompany=/);
assert.match(merchantLive,/Cadastrar outra empresa/);
assert.ok(merchantLive.includes('${anotherCompany}'),
 'approved application must not strand an owner who wants another company');
assert.ok(growth.includes("if(route()!=='merchant-join')go('merchant-join')"),
 'new-company button from the dashboard must route to the form');

// Brazilian WhatsApp links normally provide +55, while the Edge endpoint
// already accepts 10–13 numeric digits. Do not block authentic prospects.
const phoneStart=growth.indexOf('function onlyDigits(v)');
const phoneEnd=growth.indexOf('function merchantJoinInvalid(',phoneStart);
assert.ok(phoneStart>=0&&phoneEnd>phoneStart);
const phoneCtx=vm.createContext({});
vm.runInContext(growth.slice(phoneStart,phoneEnd)+';this.validPhone=isValidPhoneShape;',phoneCtx);
for(const number of [
  '(55) 99999-9999', '55 99999-9999', '+55 55 99999-9999',
  '+55 (11) 98765-4321', '(11) 3456-7890', '+55 11 3456-7890'
]){
 assert.equal(phoneCtx.validPhone(number),true,'Brazilian WhatsApp accepted: '+number);
}
for(const number of ['123','+54 11 98765-4321','5500000000000',
  '551198765432109','55559876543210','11 1234567']){
 assert.equal(phoneCtx.validPhone(number),false,'invalid/unsupported input rejected: '+number);
}
assert.ok(read('supabase/functions/submit-merchant-application/index.ts')
 .includes('if(phone.length<10||phone.length>13)'),
 'server-side registered length must still be checked');


// After admin approval, a no-access applicant must be able to check the
// latest status without logging out, registering another CNPJ, or reloading.
// The refresh is read-only and scoped by server-side applicant_user_id.
const noAccessStart=merchantLive.indexOf('function merchantLiveNoAccess(){');
const noAccessEnd=merchantLive.indexOf('\nfunction merchantLiveProduct(',noAccessStart);
const refreshStart=merchantLive.indexOf('async function merchantLiveRefresh(){');
const refreshEnd=merchantLive.indexOf('\nfunction merchantDeliveryAssignmentChanged(',refreshStart);
assert.ok(noAccessStart>=0&&noAccessEnd>noAccessStart&&
  refreshStart>=0&&refreshEnd>refreshStart);
const applicantState={
 status:'no-access',session:{access_token:'auth-test',user:{email:'contact@example.test'}},
 ownApplications:[{id:'app-1',company_name:'Empresa Alfa',status:'pending'}],
 applicationFetchError:null,onboardingRefreshPending:false
};
let refreshedApplications=0,merchantReadCalls=0,applicantRenders=0;
let failApplicationRead=false;
const applicantCtx=vm.createContext({
 globalThis:{
  merchantRuntime:applicantState,
  merchantOwnApplicationForInvite:()=>applicantState.ownApplications[0],
  merchantPilotInviteToken:()=>'',merchantProspectInviteToken:()=>''
 },
 shell:html=>html,esc:value=>String(value??'')
  .replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])),
 merchantRefresh:async()=>{merchantReadCalls++;},
 merchantLoadOwnApplications:async()=>{
  refreshedApplications++;
  if(failApplicationRead)throw Error('temporary-network-error');
  applicantState.ownApplications=[{
   id:'app-1',company_name:'Empresa Alfa',status:'approved'
  }];
 },
 toast:()=>{},render:()=>{applicantRenders++}
});
vm.runInContext(
 merchantLive.slice(noAccessStart,noAccessEnd)+
 merchantLive.slice(refreshStart,refreshEnd)+
 ';this.page=merchantLiveNoAccess;this.refresh=merchantLiveRefresh;',
 applicantCtx
);
assert.match(applicantCtx.page(),/Atualizar situação da minha empresa/);
assert.match(applicantCtx.page(),/Cadastro em análise/);
await applicantCtx.refresh();
assert.equal(merchantReadCalls,1);
assert.equal(refreshedApplications,1);
assert.match(applicantCtx.page(),/Cadastro aprovado/);
assert.ok(applicantRenders>0);
assert.equal(applicantState.onboardingRefreshPending,false);
failApplicationRead=true;
await applicantCtx.refresh();
assert.equal(refreshedApplications,2);
assert.match(applicantCtx.page(),/Não foi possível conferir seus cadastros/);
assert.match(applicantCtx.page(),/role="alert"/);
applicantState.status='ready';
await applicantCtx.refresh();
assert.equal(refreshedApplications,2,
 'approved owner must not query no-access applications unnecessarily');
assert.ok(read('supabase/functions/submit-merchant-application/index.ts')
 .includes('.eq("applicant_user_id",user.id)'),
 'backend applicant lookup must be scoped to the signed-in identity');

console.log('V1.410 PASS: fast signup, referral, email OTP continuity, existing access and safe fallback.');
