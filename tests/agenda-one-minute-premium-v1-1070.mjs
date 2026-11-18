import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const source=read('js/agenda-design.js'),agenda=read('js/agenda.js'),css=read('css/agenda-design.css');
const sql=read('tests/sql/agenda-page-design-owner-rls-v1-1070.sql');
new vm.Script(source,{filename:'js/agenda-design.js'});
assert.match(css,/agenda-design-quick-actions/);
assert.match(css,/agenda-design-preview-frame\.is-mobile/);
assert.match(css,/max-width:620px/);
assert.match(sql,/set local role anon/);
assert.match(sql,/set local role authenticated/);
assert.match(sql,/AGENDA_CROSS_OWNER_INSERT_ALLOWED/);
assert.match(sql,/AGENDA_ANON_SAW_UNPUBLISHED_DESIGN/);
assert.match(sql,/rollback;/);
assert.match(agenda,/agenda_book_slot/,'Real booking flow stays in the original Agenda module');
assert.doesNotMatch(source,/agenda_book_slot|mercadopago|payment_attempt|PIX_GENERAT/i,
 'Visual-only code must never create bookings or financial activity');

const owner='10700000-0000-4000-8000-000000000001';
const serviceId='10700000-0000-4000-8000-000000000011';
const staffId='10700000-0000-4000-8000-000000000012';
const firstPhoto=owner+'/10700000-0000-4000-8000-000000000013.webp';
const profile={id:'10700000-0000-4000-8000-000000000014',
 slug:'barbearia-um',title:'Barbearia do Centro',city:'São Gabriel',about:'Cortes e atendimento com hora marcada.',
 photo_paths:[firstPhoto],photos:[firstPhoto],published:true,
 services:[{id:serviceId,title:'Corte & Barba',price_cents:7000,duration_min:45,active:true}],
 staff:[{id:staffId,name:'João & Equipe',active:true}]};
const runtime={page:profile,services:profile.services,staff:profile.staff,
 design:null,designDraft:null,designDraftOwnerId:'',user:{id:owner},
 client:null,busy:false,designUnavailable:false,notice:'',error:''};
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({
 '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
class FakeFormData{
 constructor(form){this.values=form.values;}
 get(key){return Object.prototype.hasOwnProperty.call(this.values,key)?this.values[key]:null;}
}
let rendered=0;
const doc={getElementById:()=>null};
const ctx=vm.createContext({
 agendaRuntime:runtime,FormData:FakeFormData,document:doc,console,
 crypto:{randomUUID:()=> '10700000-0000-4000-8000-000000000077'},
 agendaPhotoUrl:path=>path===firstPhoto?'https://example.invalid/cover.webp':
  path.endsWith('.webp')?'https://example.invalid/second.webp':'',
 agendaMoney:cents=>'R$ '+(Number(cents)/100).toFixed(2).replace('.',','),
 agendaShareLink:slug=>'https://tamao.com.br/agenda/'+slug,
 esc,render:()=>{rendered++;},agendaRefreshOwner:async()=>{}
});
vm.runInContext(source,ctx,{filename:'js/agenda-design.js'});

assert.equal(ctx.agendaDesignSuggestedTheme({title:'Barbearia do Centro'}),'black-gold');
assert.equal(ctx.agendaDesignSuggestedTheme({title:'Salão Estética Avançada'}),'elegance');
assert.equal(ctx.agendaDesignSuggestedTheme({title:'Clínica Odontológica'}),'clean');
assert.equal(ctx.agendaDesignSuggestedTheme({title:'SPA e Maquiagem'}),'elegance');
const d=ctx.agendaDesignCurrent();
assert.equal(d.template,'black-gold','Barbers should receive a contextual design without filling fields');
assert.equal(d.cover_index,0,'Previously uploaded first photo is the ready-made cover');
assert.equal(d.logo_index,-1,'Never present an unselected picture as a business logo');
const initial=ctx.agendaDesignOwnerEditor();
for(const value of ['Usar este visual','Escolha um modelo','Black Gold','Elegance','Clean',
 'Ver a prévia da página','Computador','Celular','Personalizar mais','Salvar personalização',
 'Foto de capa','Fotos dos serviços','Fotos da equipe','Localização']){
 assert.ok(initial.includes(value),'Missing usable setup choice: '+value);
}
assert.ok(initial.indexOf('Usar este visual')<initial.indexOf('Personalizar mais'),
 'Fast default action must be before optional settings');
assert.match(initial,/<details class="agenda-design-advanced"><summary>/,
 'Optional settings must start collapsed');
assert.doesNotMatch(initial,/<input[^>]+required[^>]+name="headline"/,
 'Business must not type its name a second time');
assert.ok(initial.includes('name="template" value="black-gold" checked'));
assert.ok(initial.includes('name="cover_index"'));
assert.ok(!initial.includes('Reservas confirmadas: 1'),'Do not invent clients or reviews');

const values={
 template:'black-gold',primary_color:'#111111',accent_color:'#caa86c',
 font_style:'classic',headline:'Meu negócio <premium>',tagline:'Serviços para você',
 cover_index:'0',logo_index:'-1',highlights:'Atendimento por horário\nAmbiente confortável',
 instagram:'barbearia.centroum',street_address:'Rua Central, 10',
 ['service_'+serviceId]:'0',['staff_'+staffId]:'0',
 show_about:'on',show_team:'on',show_gallery:'on',show_location:'on',show_highlights:'on'
};
const form={values},evt={target:form,preventDefault(){this.prevented=true;}};
const snapshot=ctx.agendaDesignReadForm(form);
assert.equal(snapshot.template,'black-gold');
assert.equal(snapshot.headline,'Meu negócio <premium>');
assert.equal(snapshot.cover_index,0);
assert.equal(snapshot.service_images[serviceId],0);
assert.equal(snapshot.staff_images[staffId],0);
assert.equal(snapshot.highlights.length,2);
assert.equal(snapshot.show_team,true);
const preview=ctx.agendaDesignPreviewMarkup(snapshot,profile);
assert.match(preview,/Meu negócio &lt;premium&gt;/);
assert.doesNotMatch(preview,/<premium>/);
assert.match(preview,/Corte &amp; Barba/);
assert.match(preview,/João &amp; Equipe/);
assert.match(preview,/Rua Central, 10/);

let writes=[];
const successClient={
 from(table){
  assert.equal(table,'agenda_page_design','One-click appearance update must not alter financial/calendar tables');
  return {upsert(data,opts){
   assert.equal(opts.onConflict,'page_id');
   writes.push(data);
   return {select(){return {single:async()=>({data:{...data},error:null})};}};
  }};
 }
};
runtime.client=successClient;
await ctx.agendaDesignSave(evt);
assert.equal(evt.prevented,true);
assert.equal(writes.length,1);
assert.equal(runtime.design.headline,values.headline);
assert.equal(runtime.designDraft,null);
assert.equal(runtime.designDraftOwnerId,'');
assert.equal(runtime.busy,false);
assert.match(runtime.notice,/Visual salvo/);
assert.match(ctx.agendaDesignOwnerEditor(),/Salvar meu visual/);
assert.match(ctx.agendaDesignOwnerEditor(),/Ver minha página/);

values.headline='Texto que não pode desaparecer';
runtime.client={from:()=>({upsert:()=>({select:()=>({single:async()=>({
 data:null,error:{message:'offline'}
})})})})};
await ctx.agendaDesignSave(evt);
assert.match(runtime.error,/escolhas foram preservadas/);
assert.equal(runtime.designDraft.headline,values.headline,'Failed request must keep draft');
assert.match(ctx.agendaDesignOwnerEditor(),/Texto que não pode desaparecer/);
assert.equal(runtime.design.headline,'Meu negócio <premium>','Failure cannot claim new save succeeded');

const beforeInvalid=rendered;
values.highlights='um\ndois\ntrês\nquatro\ncinco';
await ctx.agendaDesignSave(evt);
assert.equal(runtime.busy,false);
assert.equal(rendered,beforeInvalid+1);
assert.match(runtime.error,/Revise/);
values.highlights='Atendimento por horário';
values.template='xss';
await ctx.agendaDesignSave(evt);
assert.match(runtime.error,/Revise/);
values.template='clean';
const wrongPage={...profile,id:'10700000-0000-4000-8000-000000000099',title:'Clínica Nova',photo_paths:[]};
runtime.page=wrongPage;
assert.notEqual(ctx.agendaDesignCurrent().headline,values.headline,
 'Draft from another page must never leak between participants');
assert.equal(ctx.agendaDesignCurrent().template,'clean','Foreign page must use its own default, never another owner’s saved theme');
runtime.design=null;
assert.equal(ctx.agendaDesignCurrent().template,'clean');
runtime.page=profile;
runtime.designDraft=null;runtime.designDraftOwnerId='';

let releaseSingle;
writes=[];
runtime.client={from:()=>({upsert:data=>{
 writes.push(data);
 return {select:()=>({single:()=>new Promise(resolve=>{releaseSingle=resolve;})})};
}})};
values.headline='Um clique, não dois';
const first=ctx.agendaDesignSave(evt);
const repeat=ctx.agendaDesignSave(evt);
assert.equal(runtime.busy,true);
assert.equal(writes.length,1,'Second click must not duplicate the write');
await repeat;
releaseSingle({data:{...writes[0]},error:null});
await first;
assert.equal(runtime.busy,false);
assert.equal(runtime.design.headline,'Um clique, não dois');

runtime.design=null;runtime.designDraft=null;
runtime.designDraftOwnerId='';runtime.page=profile;
values.headline='Foto + rascunho protegido';
const nextPath=owner+'/10700000-0000-4000-8000-000000000077.webp';
let uploaded=0,removed=0,linked=0;
runtime.client={
 storage:{from:bucket=>{
  assert.equal(bucket,'tamao-discovery-photos');
  return {upload:async()=>{uploaded++;return {error:null};},
   remove:async()=>{removed++;return {error:null};}};
 }},
 from:table=>{
  assert.equal(table,'agenda_pages');
  return {update:data=>{
   linked++;assert.deepEqual([...data.photo_paths],[firstPhoto,nextPath]);
   return {eq(){return this;},select(){return {single:async()=>({
    data:{...profile,photo_paths:[firstPhoto,nextPath]},error:null
   })};}};
  }};
 }
};
doc.getElementById=id=>id==='agenda-design-form'?form:null;
await ctx.agendaDesignUploadPhoto({target:{files:[{type:'image/webp',size:198000}]}});
assert.equal(uploaded,1);assert.equal(linked,1);assert.equal(removed,0);
assert.equal(runtime.designDraft.headline,'Foto + rascunho protegido');
assert.match(ctx.agendaDesignOwnerEditor(),/Foto \+ rascunho protegido/);
assert.equal(runtime.page.photo_paths.length,2);
await ctx.agendaDesignUploadPhoto({target:{files:[{type:'image/svg+xml',size:400}]}});
assert.equal(uploaded,1,'Blocked media type cannot upload');
await ctx.agendaDesignUploadPhoto({target:{files:[{type:'image/png',size:6000000}]}});
assert.equal(uploaded,1,'Oversized image cannot upload');

const previewTarget={classList:{states:[],toggle(cls,b){this.states.push({cls,b})}}};
const toggles=[{setAttribute(k,v){this[k]=v;}},{setAttribute(k,v){this[k]=v;}}];
toggles[1].parentElement={querySelectorAll:()=>toggles};
doc.getElementById=id=>id==='agenda-design-preview'?previewTarget:null;
ctx.agendaDesignPreviewSize(toggles[1],'mobile');
assert.equal(previewTarget.classList.states[0].b,true);
assert.equal(toggles[1]['aria-pressed'],'true');
assert.equal(toggles[0]['aria-pressed'],'false');

let focused=false,scrolled=false,pane={open:false};
doc.getElementById=id=>id==='agenda-profile-form'?{
 closest:()=>pane,scrollIntoView(){scrolled=true;},
 querySelector:()=>({focus(){focused=true;}})
}:null;
ctx.agendaDesignOpenPublishing();
assert.equal(pane.open,true);assert.equal(focused,true);assert.equal(scrolled,true);

console.log('TAMÃO Agenda V1.1070 PASS — contextual defaults, one-click save, mobile preview, inputs, no duplicate writes, failed-save draft, uploads and owner isolation.');
