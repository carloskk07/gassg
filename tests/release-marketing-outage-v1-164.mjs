import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const source=read('js/core.js');
const start=source.indexOf('function runtimeStrip(){');
const end=source.indexOf('\nfunction siteFooter(',start);
assert.ok(start>=0&&end>start,'Runtime status banner not found');
const runtimeSource=source.slice(start,end);
const marketPages=['home','learn','earn','club','refer','merchants','privacy','terms','contact'];
function renderStatus(routeName,mode='unavailable',options={}){
 const globalThis={
   __CHAMA_TEST__:false,
   liveRuntime:{status:options.unsafeOrigin?'unsafe-origin':'unavailable'},
   adminPortalRequested:()=>false,merchantPortalRequested:()=>false,
   liveBanner:()=>mode,prelaunchExamplesEnabled:()=>false
 };
 const ctx=vm.createContext({globalThis,route:()=>routeName});
 return vm.runInContext(runtimeSource+';runtimeStrip()',ctx);
}
for(const page of marketPages){
 const view=renderStatus(page);
 assert.ok(view.includes('calm-strip'),'Informational '+page+' must avoid checkout danger styling');
 assert.ok(view.includes('Consulta indisponível no momento'),'Outage must remain disclosed');
 assert.ok(!view.includes('nenhum pedido foi criado'),'Institutional page must not imply an attempted transaction');
}
for(const page of ['order','tracking']){
 const view=renderStatus(page);
 assert.ok(view.includes('blocked-strip'),'Order '+page+' must keep unmistakable outage treatment');
 assert.ok(view.includes('nenhum pedido foi criado'),'No phantom transaction may be suggested');
}
assert.ok(renderStatus('home','live').includes('OPERAÇÃO ATIVA'),'Server-confirmed live status retains source authority');
assert.ok(renderStatus('home','connecting').includes('Preparando sua experiência'),'Connecting keeps accurate progression');
assert.ok(renderStatus('home','unavailable',{unsafeOrigin:true}).includes('use o endereço oficial'),'Origin-blocked pages must tell the user to use official origin');
const customer=read('js/customer.js');
assert.ok(customer.includes("'Consulta indisponível'"),'Offer area must not claim to be indefinitely connecting');
assert.ok(customer.includes("'Ofertas não verificadas agora. Nenhum pedido foi criado.'"),'No quote can be implied during outage');
assert.ok(read('css/components.css').includes('.calm-strip{background:'),'Marketing degraded state needs neutral legible visual treatment');
console.log('Release visual review: 9 informative routes calm and honest; order, tracking and unsafe-origin safety unchanged.');
