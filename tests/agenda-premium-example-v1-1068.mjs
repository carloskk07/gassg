import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const html=read('agenda/exemplo/index.html');
const css=read('agenda/exemplo/style.css');
const script=read('agenda/exemplo/page.js');
const agenda=read('agenda/index.html');
const runtime=read('js/agenda.js');
const build=read('scripts/build-live-portals.mjs');
const workflow=read('.github/workflows/audit.yml');

for(const section of ['inicio','sobre','servicos','equipe','galeria','recursos','agendamento','contato']){
 assert.match(html,new RegExp('id="'+section+'"'),'Missing demo section '+section);
}
assert.match(html,/Barbearia <em>Black Gold<\/em>/);
assert.match(html,/<meta name="robots" content="noindex,follow/);
assert.match(html,/Página de demonstração/);
assert.match(html,/Este[a-z]*.*demonstração|Esta página é um exemplo|projeto ilustrativo/si);
assert.match(html,/https:\/\/unsplash\.com\/license/);
assert.match(html,/aria-live="polite"/);
assert.match(html,/<dialog id="gallery-dialog"/);
assert.match(html,/\/agenda\/\?agenda=1&amp;criar=1/);
assert.match(html,/<link rel="canonical" href="https:\/\/tamao\.com\.br\/agenda\/exemplo\/"/);
assert.match(html,/href="\/agenda\/"/);
assert.match(html,/\/agenda\/exemplo\/style\.css/);
assert.match(html,/\/agenda\/exemplo\/page\.js/);
assert.doesNotMatch(html,/(?:src|href)="(?:https?:\/\/(?:example|instagram|wa\.me|api\.whatsapp|mercadopago))/);
assert.doesNotMatch(html,/(?:\b\d,\d\s*\(\d+ avaliações\)|\b\d{3} avaliações|Bruno Alves|Mateus Rocha|Diego Santos)/);
assert.doesNotMatch(html,/(?:name="(?:customer_name|customer_phone|cpf|email)"|\/rpc\/agenda_book|input.+type="tel")/);
const srcs=Array.from(html.matchAll(/(?:src|content)="(https:\/\/images\.unsplash\.com\/[^"]+)"/g),m=>m[1]);
assert.ok(srcs.length>=15,'Gallery, services, hero, staff and preview should use real photographic sources');
assert.ok(new Set(srcs.map(s=>s.split('?')[0])).size>=8,'Showcase should use diverse freely licensed images');
for(const src of srcs)assert.match(src,/^https:\/\/images\.unsplash\.com\/photo-[0-9]+-[a-z0-9]+\?auto=format&fit=crop&w=\d+&q=\d+$/);
assert.match(css,/@media\(max-width:930px\)/);
assert.match(css,/@media\(max-width:720px\)/);
assert.match(css,/@media\(max-width:460px\)/);
assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
assert.match(css,/\.mobile-menu/);
assert.match(css,/\.service-grid/);
assert.match(css,/\.gallery-grid/);
assert.match(css,/\.booking-fields/);
assert.match(css,/\.gallery-photo:focus-visible|button:focus-visible/);
assert.match(agenda,/href="\/agenda\/exemplo\/">Ver página exemplo/);
assert.match(runtime,/agenda-example-invite/);
assert.match(runtime,/agenda-example-preview/);
assert.match(runtime,/Explorar página exemplo/);
assert.match(runtime,/agendaStartOwner\(\)/);
const nativeRoutes=read('scripts/cloudflare-native-routes-v1-1073.mjs');
assert.match(build,/TAMAO_CLOUDFLARE_NATIVE_ROUTES/);
assert.match(nativeRoutes,/\/agenda\/exemplo\/ \/agenda\/exemplo\/index\.html 200/);
assert.ok(nativeRoutes.indexOf('/agenda/exemplo/')<
          nativeRoutes.indexOf('/agenda/:slug/'),'Specific premium example must take priority over professional slug router');
assert.match(build,/copyDir\(path\.join\(ROOT,'agenda'\),path\.join\(target,'agenda'\)\)/);
assert.match(workflow,/node tests\/agenda-premium-example-v1-1068\.mjs/);

new vm.Script(script,{filename:'agenda/exemplo/page.js'});
class Element {
 constructor(dataset={}){this.dataset=dataset;this.listeners={};this.attributes={};this.value='';this.textContent='';this.focused=false;this.classList={toggle:()=>{},remove:()=>{}};}
 addEventListener(type,cb){(this.listeners[type] ||= []).push(cb)}
 emit(type,data={}){for(const fn of this.listeners[type]||[])fn({...data,target:this})}
 setAttribute(k,v){this.attributes[k]=v}
 getAttribute(k){return this.attributes[k]||null}
 focus(){this.focused=true}
 scrollIntoView(){}
 querySelector(){return null}
 contains(other){return other===this}
}
const controls={
 'menu-toggle':new Element(),
 'main-navigation':new Element(),
 'booking-service':new Element(),
 'booking-person':new Element(),
 'booking-date':new Element(),
 'demo-booking':new Element(),
 'booking-feedback':new Element(),
 'booking-price':new Element(),
 'agendamento':new Element(),
 'gallery-dialog':new Element(),
 'gallery-large':new Element(),
 'gallery-caption':new Element(),
 'dialog-close':new Element()
};
controls['booking-service'].value='corte';
controls['booking-person'].value='01';
controls['main-navigation'].querySelectorAll=()=>[];
controls['booking-feedback'].dataset={};
controls['gallery-dialog'].showModal=function(){this.open=true};
controls['gallery-dialog'].close=function(){this.open=false;this.emit('close')};
controls['gallery-large'].removeAttribute=function(){this.src=''};
controls['menu-toggle'].attributes['aria-expanded']='false';
const times=['09:00','10:00','11:00','14:00','15:00','16:00'].map(slot=>new Element({slot}));
const services=['corte','barba','combo','acabamento'].map(service=>new Element({service}));
let scrolled=false;
controls.agendamento.scrollIntoView=()=>{scrolled=true};
const doc={
 getElementById:id=>controls[id]||null,
 querySelectorAll:selector=>{
  if(selector==='#time-grid [data-slot]')return times;
  if(selector==='[data-service]')return services;
  if(selector==='[data-gallery]')return [];
  throw Error('Unexpected DOM selector '+selector);
 },
 addEventListener(){}
};
vm.runInNewContext(script,{document:doc,window:{matchMedia:()=>({matches:true})},Intl,Date,console});
assert.match(controls['booking-date'].min,/^\d{4}-\d\d-\d\d$/);
assert.match(controls['booking-date'].max,/^\d{4}-\d\d-\d\d$/);
assert.ok(controls['booking-date'].value>=controls['booking-date'].min);
services[2].emit('click');
assert.equal(controls['booking-service'].value,'combo');
assert.equal(controls['booking-price'].textContent,'R$ 70,00');
assert.equal(scrolled,true);
const form=controls['demo-booking'];
let prevented=false;
form.emit('submit',{preventDefault(){prevented=true}});
assert.equal(prevented,true);
assert.match(controls['booking-feedback'].textContent,/Selecione um dos horários/);
times[1].emit('click');
assert.equal(times[1].getAttribute('aria-pressed'),'true');
assert.equal(times[0].getAttribute('aria-pressed'),'false');
form.emit('submit',{preventDefault(){}});
assert.match(controls['booking-feedback'].textContent,/nenhuma reserva ou pagamento foi realizado/);
assert.equal(controls['booking-feedback'].dataset.state,'success');
assert.doesNotMatch(script,/fetch\(|\.rpc\(|(?:client|supabase)\.from\(|XMLHttpRequest|localStorage|sessionStorage|geolocation|window\.open\(/);
console.log('V1.1068 PASS: standalone premium showcase, accessible visual sections, photos licensing, real site routes, interactive but non-booking preview and mobile contracts.');
