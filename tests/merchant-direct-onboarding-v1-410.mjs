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
assert.ok(growth.includes('class="merchant-secondary-lead"'));
assert.ok(growth.includes('Prefere conversar antes? Deixe seu contato'));
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
console.log('V1.410 PASS: fast signup, campaign ref, existing access, safe fallback and optional contact.');
