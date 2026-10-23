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
const gateStart=bootstrap.indexOf("if(globalThis.liveRequested?.()&&(['order','tracking'].includes(route())");
const gateEnd=bootstrap.indexOf("{\n      await backendInit();",gateStart);
assert.ok(gateStart>=0&&gateEnd>gateStart,'customer runtime must be deferred unless order or existing session');
const authExpression=bootstrap.slice(gateStart+3,gateEnd).trim().slice(0,-1);
const needsAuth=new Function('globalThis','route','localStorage','return ('+authExpression+');');
const evaluate=(name,stored='')=>needsAuth(
 {liveRequested:()=>true},
 ()=>name,
 {getItem:key=>{
  assert.equal(key,'chama-sg-customer-auth-v2');
  return stored||null;
 }}
);
assert.equal(evaluate('home'),false,'a first-time visitor must browse without CAPTCHA');
for(const path of ['learn','merchants','professionals','rides','stays','privacy']){
 assert.equal(evaluate(path),false,'informational navigation must not request an identity: '+path);
}
for(const path of ['order','tracking']){
 assert.equal(evaluate(path),true,'protected journey must require secure Auth: '+path);
}
assert.equal(evaluate('home',JSON.stringify({access_token:'saved-session'})),true,
 'returning customer session must initialize the real backend');
assert.equal(evaluate('home','{invalid'),false,'invalid saved state cannot force challenge');
assert.match(bootstrap,/\['order','tracking'\]\.includes\(route\(\)\)[\s\S]*?backendInit\(\)\.then\(\(\)=>render\(\)\)/,
 'navigation to the order or tracking route must initialize the same real Auth flow');
assert.ok(!bootstrap.includes('tamaoCustomerInitWhenNeeded'),
 'deferred auth must not add a parallel bootstrap system');

console.log('Stable public menus, compact noninteractive preboot and safe availability navigation PASS');
