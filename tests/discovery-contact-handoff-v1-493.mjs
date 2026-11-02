import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const source=read('js/discovery.js');
new vm.Script(source,{filename:'discovery.js'});
const uuid='99999999-9999-4999-8999-999999999999';
const tomorrow=new Date(Date.now()+24*3600000).toISOString();
let kind='rides',renders=0;
const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({
 '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
})[ch]);
const ctx={Date,URL,URLSearchParams,esc,console,
 route:()=>kind,render:()=>renders++,shell:x=>x,
 BRL:new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}),
 location:{origin:'https://tamao.com.br',search:'',hash:'#rides'},
 CHAMA_BACKEND:{url:'https://example.invalid',publishableKey:'public-test'}};
ctx.globalThis=ctx;
vm.runInNewContext(source,ctx);
const row=(vertical,other={})=>({
 id:uuid,vertical,title:'Consulta publicada',whatsapp_e164:'+555599998888',
 departure_at:tomorrow,seats_available:3,guests:4,
 occupation:'Mototáxi',...other
});
function publish(vertical,listing){
 kind=vertical;
 const s=ctx.discoveryState(vertical);
 s.status='ready';s.items=[listing];s.error='';return s;
}
function handoff(item,values={},mode=''){
 const vertical=item.vertical;
 const feedback={textContent:''};
 const box={dataset:{listingId:item.id,phone:item.whatsapp_e164,
   kind:vertical,service:mode,title:item.title,max:String(
   vertical==='rides'?item.seats_available:vertical==='stays'?item.guests:0),
   departure:vertical==='rides'?item.departure_at:''},
  querySelector(q){
   if(q==='.discovery-inquiry-feedback')return feedback;
   const match=q.match(/\[name="([^"]+)"\]/);
   return match&&Object.hasOwn(values,match[1])?{value:values[match[1]]}:null;
  }};
 const anchor={href:'#',closest:()=>box,removeAttribute(name){if(name==='href')this.href=''}};
 return {anchor,box,feedback,click:()=>ctx.discoveryPrepareInquiry(anchor)};
}
function direct(item){
 return {href:ctx.discoveryWhatsApp(item),dataset:{listingId:item.id},
  removeAttribute(name){if(name==='href')this.href=''}};
}
// Driver publishes a carpool. Visitor sees a currently loaded listing,
// requests two seats, and can prepare an explicitly non-binding conversation.
let ride=row('rides'),state=publish('rides',ride);
assert.match(ctx.discoveryInquiryForm(ride,'rides'),new RegExp('data-listing-id="'+uuid+'"'));
assert.match(ctx.discoveryCard(ride,'rides'),/discoveryConfirmRideContact\(this\)/);
let form=handoff(ride,{seats:'2'});
assert.equal(form.click(),true,'verified public ride may prepare a WhatsApp inquiry');
assert.match(decodeURIComponent(form.anchor.href),/consultar 2 vagas/);
let link=direct(ride);
assert.equal(ctx.discoveryConfirmRideContact(link),true);

// The driver updates seats (or withdraws all seats), while an old form
// remains in a visitor tab. The stale capacity MUST fail closed.
state.items=[row('rides',{seats_available:1})];
assert.equal(form.click(),false,'stale 3-seat form cannot consult after 1-seat refresh');
assert.equal(form.anchor.href,'','stale link must be invalidated');
assert.match(form.feedback.textContent,/mudou/);
form=handoff(state.items[0],{seats:'1'});
assert.equal(form.click(),true,'fresh form with current seats should work');
assert.equal(handoff(state.items[0],{seats:'2'}).click(),false,
 'capacity must be checked against current server-result row');
state.items=[row('rides',{seats_available:0})];
assert.equal(form.click(),false,'full carpool cannot use the old form');
assert.equal(ctx.discoveryConfirmRideContact(link),false);
state.items=[row('rides',{whatsapp_e164:'+555598887777'})];
assert.equal(form.click(),false,'old phone must not leave the browser');
state.items=[row('rides',{title:'Outro percurso'})];
assert.equal(form.click(),false,'modified title invalidates prior inquiry');
state.items=[];
assert.equal(form.click(),false,'withdrawn listing cannot be contacted from stale form');
state.status='loading';
assert.equal(form.click(),false,'a new search cannot authorize an old form');

// Direct contacts for services and stays must also reject withdrawn or
// updated listing phone numbers, not only carpool links.
for(const vertical of ['professionals','stays']){
 const item=row(vertical);
 const current=publish(vertical,item);
 const a=direct(item);
 assert.equal(ctx.discoveryConfirmDirectContact(a),true,vertical+' current direct contact');
 current.items=[{...item,whatsapp_e164:'+555598887777'}];
 assert.equal(ctx.discoveryConfirmDirectContact(a),false,vertical+' stale phone denied');
 assert.equal(a.href,'');
 assert.match(current.savedNotice,/Atualize a busca/);
 current.items=[];
 assert.equal(ctx.discoveryConfirmDirectContact(direct(item)),false);
}

// Full lodging inquiry: dates and guests validated as before; after a
// capacity change or phone revocation the old form cannot open WhatsApp.
let stay=row('stays'),stayState=publish('stays',stay);
const checkin=new Date(Date.now()+2*86400000).toISOString().slice(0,10);
const checkout=new Date(Date.now()+3*86400000).toISOString().slice(0,10);
let lodging=handoff(stay,{checkin,checkout,guests:'3'});
assert.equal(lodging.click(),true);
assert.match(decodeURIComponent(lodging.anchor.href),/3 hóspedes/);
stayState.items=[{...stay,guests:2}];
assert.equal(lodging.click(),false,'reduced capacity rejects previous lodging inquiry');
lodging=handoff(stayState.items[0],{checkin,checkout,guests:'2'});
assert.equal(lodging.click(),true);
stayState.items=[{...stayState.items[0],whatsapp_e164:'+555598887777'}];
assert.equal(lodging.click(),false,'withdrawn lodging phone invalidates cached inquiry');

// Passenger transport quotes must follow the current driver category;
// a moto form must not contact a listing reclassified as a car driver.
const pro=row('professionals'),proState=publish('professionals',pro);
ctx.discoveryState('professionals').service='moto';
const moto=handoff(pro,{origin:'Centro',destination:'Rodoviária',service:'',
 preferred_day:''},'moto');
assert.equal(moto.click(),true);
proState.items=[{...pro,occupation:'Motorista / Táxi'}];
assert.equal(moto.click(),false,'reclassified driver cannot receive old moto query');
proState.items=[pro];
assert.equal(moto.click(),true,'valid current category permits inquiry again');
assert.ok(renders>=2,'stale contact should update the visitor notice');
assert.match(read('.github/workflows/audit.yml'),/node tests\/discovery-contact-handoff-v1-493\.mjs/);
console.log('PASS #493 discovery full contact handoff: seats, availability, departure, capacity, phone, listing withdrawal and service category.');
