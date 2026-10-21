import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const core=read('js/core.js'),discovery=read('js/discovery.js'),css=read('css/discovery.css');
const start=core.indexOf('function runtimeStrip(){'),end=core.indexOf('function siteFooter(',start);
assert.ok(start>0&&end>start,'Original runtime strip must exist');
const isolated=core.slice(start,end);
function banner(page,{unsafe=false}={}){
 return vm.runInNewContext(isolated+';runtimeStrip()',{
  route:()=>page,
  globalThis:{
   adminPortalRequested:()=>false,merchantPortalRequested:()=>false,
   __CHAMA_TEST__:false,liveRuntime:{status:unsafe?'unsafe-origin':'ready'},
   prelaunchExamplesEnabled:()=>false,liveBanner:()=>unsafe?'connecting':'live'
  }
 });
}
for(const page of ['professionals','rides','stays','advertise','mobility'])
 assert.equal(banner(page),'','Discovery '+page+' must not show a checkout-only banner');
assert.equal(banner('home'),'','Home remains free of a redundant live banner');
assert.match(banner('order'),/OPERAÇÃO ATIVA/,'Checkout still shows runtime status');
assert.match(banner('professionals',{unsafe:true}),/ATENDIMENTO INDISPONÍVEL NESTA ORIGEM/,'Unsafe origin notice preserved');
assert.match(discovery,/discovery-page discovery-'\+kind/,'Distinct discovery form layout classes');
for(const selector of [
 '.discovery-professionals .discovery-search>label:nth-child(3)',
 '.discovery-stays .discovery-search>label:nth-child(5)',
 '.discovery-rides .discovery-search>label:nth-child(6)',
 '@media(max-width:900px)','@media(max-width:600px)'
])assert.ok(css.includes(selector),'Responsive selector missing: '+selector);
new vm.Script(core);new vm.Script(discovery);
console.log('PASS: contextual service banners, checkout notices, responsive discovery form contract');
