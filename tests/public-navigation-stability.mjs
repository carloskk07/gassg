import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const core=read('js/core.js'),html=read('index.html'),css=read('css/marketing-premium.css');
const shell=core.split('function shell(content){')[1]?.split('function bottomNav(r){')[0]||'';
const mobile=core.split('function bottomNav(r){')[1]?.split('function setMode(m)')[0]||'';
assert.ok(shell&&mobile);
assert.doesNotMatch(shell,/prelaunchPublic|Quero comprar|Quero vender/);
assert.doesNotMatch(mobile,/prelaunchPublic|early-access/);
assert.match(core,/function tamaoOpenAvailability\(\)/);
assert.match(core,/prelaunchExamplesEnabled\?\.\(\)===true\)return openPrelaunchCustomerLead\(\)/);
assert.match(shell,/onclick="tamaoOpenAvailability\(\)"/);
assert.match(mobile,/\['availability','🧺','Consultar','market'\]/);
assert.match(mobile,/act==='market'\?"tamaoOpenAvailability\(\)"/);
assert.match(html,/<section class="tamao-preboot" aria-label="Carregamento inicial do TAMÃO">/);
assert.match(html,/<div class="tamao-preboot-content" role="status" aria-live="polite">/);
assert.match(html,/<noscript>/);
assert.match(html,/tamao-preboot-placeholders/);
assert.doesNotMatch(html,/<nav aria-label="Conheça o TAMÃO">/);
assert.doesNotMatch(html,/tamao-preboot-primary/);
const splash=css.split('/* TAMÃO V1.376')[1]?.split('/* TAMÃO V1.377')[0]||'';
assert.match(splash,/\.tamao-preboot\{[^}]*min-height:236px/);
assert.match(splash,/background:#fbfcf9/);
assert.doesNotMatch(splash,/\.tamao-preboot nav/);
assert.doesNotMatch(splash,/min-height:610px/);

const bootstrap=read('js/bootstrap.js');
const begin=bootstrap.indexOf('function tamaoCustomerAuthNeeded(){');
const end=bootstrap.indexOf('\nlet tamaoCustomerInitPending=',begin);
assert.ok(begin>0&&end>begin,'customer route-based auth decision must exist');
const authNeeded=(name,stored='')=>{
 const fn=new Function('route','localStorage',
   bootstrap.slice(begin,end)+';return tamaoCustomerAuthNeeded();');
 return fn(()=>name,{getItem:key=>{
   assert.equal(key,'chama-sg-customer-auth-v2');
   return stored||null;
 }});
};
assert.equal(authNeeded('home'),false,
 'a first-time visitor must see the public price/catalog page without CAPTCHA');
for(const path of ['learn','merchants','professionals','rides','stays','privacy']){
 assert.equal(authNeeded(path),false,
  'public navigation cannot initiate signup challenge: '+path);
}
for(const path of ['order','tracking']){
 assert.equal(authNeeded(path),true,
  'a deliberate protected customer journey must still require secure Auth: '+path);
}
assert.equal(authNeeded('home',JSON.stringify({access_token:'existing',refresh_token:'existing'})),true,
 'returning users must restore their session and live order details');
assert.equal(authNeeded('home','{invalid'),false,'corrupt local state must not auto-challenge');
assert.match(bootstrap,/tamaoCustomerInitWhenNeeded\(\)\.catch\(/,
 'explicit protected-route navigation must initialize customer Auth');
assert.match(bootstrap,/await tamaoCustomerInitWhenNeeded\(\)/,
 'initial deep links and returning sessions must initialize customer Auth');
assert.doesNotMatch(bootstrap,/window\.addEventListener\('load',[\s\S]*?await backendInit\(\)/,
 'the initial homepage load must not unconditionally request an identity');

console.log('Stable public menus, compact noninteractive preboot and safe availability navigation PASS');
