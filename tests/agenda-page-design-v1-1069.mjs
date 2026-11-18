import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const src=read('js/agenda-design.js'), css=read('css/agenda-design.css');
const agenda=read('js/agenda.js'), html=read('agenda/index.html');
const migration=read('supabase/migrations/20261118174200_agenda_page_design_v1_1069.sql');
new vm.Script(src,{filename:'js/agenda-design.js'});
assert.match(html,/\/css\/agenda-design\.css/);
assert.match(html,/\/js\/agenda-design\.js/);
assert.ok(html.indexOf('/js/agenda-design.js')<html.indexOf('/js/agenda.js'),'load theme helpers first');
assert.match(agenda,/await agendaDesignLoadOwner\(\)/);
assert.match(agenda,/await agendaDesignLoadPublic\(s\.publicProfile\)/);
assert.match(agenda,/agendaDesignOwnerEditor\(\)/);
assert.match(agenda,/if\(s\.design&&typeof agendaDesignPublicView==='function'\)return agendaDesignPublicView\(p,form\)/);
assert.match(css,/@media\(max-width:540px\)/);
assert.match(css,/\.agenda-premium-book/);
assert.match(migration,/enable row level security/i);
assert.match(migration,/for select to anon,authenticated/);
assert.match(migration,/tamao_acl\.agenda_design_published\(page_id\)/);
assert.match(migration,/where p\.id=p_page_id and p\.published/);
assert.match(migration,/revoke all on function tamao_acl\.agenda_design_published\(uuid\) from public/);
assert.match(migration,/for insert to authenticated/);
assert.match(migration,/for update to authenticated/);
assert.match(migration,/owner_id=\(select auth\.uid\(\)\)/);
assert.match(migration,/discovery_verified_account/);
assert.doesNotMatch(migration,/grant (delete|all) on public\.agenda_page_design to (anon|authenticated)/i);
assert.doesNotMatch(src,/\/rpc\/agenda_book|mercadopago|createPayment/i);
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const owner='11111111-1111-4111-8111-111111111111', photo=owner+'/22222222-2222-4222-8222-222222222222.webp';
const serviceId='33333333-3333-4333-8333-333333333333';
const staffId='44444444-4444-4444-8444-444444444444';
const profile={id:'55555555-5555-4555-8555-555555555555',slug:'meu-salao',title:'Salão <Novo>',
 about:'Atendimento com dedicação.',city:'São Gabriel',public_area:'Centro',photo_paths:[photo],photos:[photo],
 services:[{id:serviceId,title:'Corte & Estilo',price_cents:8500,duration_min:60}],
 staff:[{id:staffId,name:'Ana & Cia'}],whatsapp:'+5555999999999'};
const runtime={page:profile,design:{template:'black-gold',cover_index:0,service_images:{[serviceId]:0},staff_images:{[staffId]:0},highlights:['Atendimento sob medida'],instagram:'salao.novo'},
 services:profile.services,staff:profile.staff,user:{id:owner},client:{},busy:false};
const ctx={agendaRuntime:runtime,esc:escape,agendaPhotoUrl:path=>path===photo?'https://valid.example/picture.webp':'',
 agendaShareLink:slug=>'https://tamao.com.br/agenda/'+slug,
 agendaMoney:n=>'R$ '+(n/100).toFixed(2).replace('.',','),
 document:{getElementById:()=>null},console};
vm.createContext(ctx);vm.runInContext(src,ctx);
const ownerHtml=ctx.agendaDesignOwnerEditor();
for(const target of ['Black Gold','Elegance','Clean','Salvar personalização','Foto de capa','Foto da marca','Fotos dos serviços','Fotos da equipe','Localização','Instagram'])
 assert.ok(ownerHtml.includes(target),'owner editor missing '+target);
assert.ok(ownerHtml.includes('name="service_'+serviceId+'"'));
assert.ok(ownerHtml.includes('agendaDesignUploadPhoto(event)'),'Direct photo upload must remain in editor');
assert.match(src,/function agendaDesignThemeChanged\(event\)/);
assert.ok(ownerHtml.includes('name="staff_'+staffId+'"'));
const publicHtml=ctx.agendaDesignPublicView({...profile,photo_paths:undefined},'<section class="agenda-panel" id="existing-booking">REAL BOOKING</section>');
for(const target of ['theme-black-gold','Corte &amp; Estilo','Ana &amp; Cia','R$ 85,00','REAL BOOKING','Atendimento sob medida','https://www.instagram.com/salao.novo/'])
 assert.ok(publicHtml.includes(target),'public premium page missing '+target);
assert.ok(publicHtml.includes('https://valid.example/picture.webp'));
assert.ok(publicHtml.includes('Salão &lt;Novo&gt;'),'Public title must be HTML-escaped');
assert.ok(!publicHtml.includes('Salão <Novo>'),'No raw user HTML');
assert.ok(!publicHtml.includes('reservas fictícias'),'No fake booking content');
assert.equal(ctx.agendaDesignColor('red','fallback'),'fallback');
assert.equal(ctx.agendaDesignColor('#Aa12bb','fallback'),'#Aa12bb');
assert.equal(ctx.agendaDesignIndex('100'),-1);
assert.equal(ctx.agendaDesignPhoto(profile,99),'');
const clean=ctx.agendaDesignPreviewMarkup({template:'clean',headline:'Teste <script>',tagline:'Seguro',cover_index:-1},profile);
assert.ok(clean.includes('Teste &lt;script&gt;'));assert.ok(!clean.includes('<script>'));
runtime.design=null;
assert.ok(ctx.agendaDesignOwnerEditor().includes('Escolha um modelo'),'No-config owner can customize');
console.log('TAMÃO Agenda V1.1069: editor, premium real page, safe escaping and SQL ACL contracts passed.');
