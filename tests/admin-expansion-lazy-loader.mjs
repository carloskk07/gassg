import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {splitAdminAcquisition} from '../scripts/build-live-portals.mjs';
const original=fs.readFileSync(new URL('../js/admin-acquisition.js',import.meta.url),'utf8');
const {core,expansion}=splitAdminAcquisition(original);
assert.equal(core+expansion,original);
assert.ok(expansion.length>90000&&expansion.length<150000);
assert.throws(()=>splitAdminAcquisition('function doNothing(){}'),/boundary/);
const admin=fs.readFileSync(new URL('../js/admin.js',import.meta.url),'utf8');
const start=admin.indexOf('// Split release bundle: city intelligence');
const end=admin.indexOf('function adminSetSection(section){',start);
assert.ok(start>0&&end>start);
const loader=admin.slice(start,end);
const scripts=[];
let section='prospects',authorized=true,ready=true,actor='owner',renders=0,calls=[];
const env=vm.createContext({
  document:{
    currentScript:{src:'https://admin.tamao.com.br/js/admin.js?v=sha-test'},
    baseURI:'https://admin.tamao.com.br/',createElement:()=>({}),
    head:{appendChild:s=>scripts.push(s)}
  },
  location:{origin:'https://admin.tamao.com.br'},
  adminRuntime:{get section(){return section},session:{user:{get id(){return actor}}}},
  adminReady:()=>ready,adminRoleCanSection:()=>authorized,
  adminProspectsSection:undefined,adminEnablementSection:undefined,
  adminLoadProspects:undefined,adminLoadEnablement:undefined,
  adminLoadExpansionRadar:undefined,adminLoadCityHistory:undefined,
  render:()=>{renders++},esc:s=>String(s),Promise,Error,String,URL
});
vm.runInContext(loader+'\nthis.load=adminExpansionLoadOnDemand;this.view=adminExpansionFallbackView;this.url=adminExpansionModuleUrl;',env);
assert.equal(env.url,'https://admin.tamao.com.br/js/admin-expansion.js?v=sha-test');
section='orders';
assert.equal(await env.load(),null);
assert.equal(scripts.length,0,'Unrelated tabs must not request the module');
section='prospects';
authorized=false;
assert.equal(await env.load(),null);
assert.equal(scripts.length,0,'Unauthorized users must not download module');
authorized=true;
const first=env.load(),second=env.load();
assert.equal(scripts.length,1,'Concurrent requests must share one script');
assert.equal(scripts[0].src,env.url);
assert.match(env.view(),/Carregando/);
scripts[0].onerror();
await Promise.all([first,second]);
assert.match(env.view(),/Tentar novamente/);
const retry=env.load();
assert.equal(scripts.length,2);
env.adminProspectsSection=()=>'<p>Prospectos</p>';
env.adminEnablementSection=()=>'<p>Habilitação</p>';
env.adminLoadProspects=async()=>{calls.push('prospects')};
env.adminLoadExpansionRadar=async()=>{calls.push('radar')};
env.adminLoadCityHistory=async()=>{calls.push('history');return true};
env.adminLoadEnablement=async()=>{calls.push('enablement');return true};
scripts[1].onload();
assert.equal(await retry,true);
assert.deepEqual(calls,['prospects','radar','history']);
section='enablement';
assert.equal(await env.load(),true);
assert.equal(scripts.length,2,'Loaded expansion must not be fetched twice');
assert.equal(calls.at(-1),'enablement');
actor='another-user';ready=false;
assert.equal(await env.load(),null);
assert.equal(calls.length,4,'Signed-out must not fetch privileged data');
console.log('Admin expansion byte parity, version pin, authorization, retry and on-demand fetch PASS');
