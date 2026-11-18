import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=file=>fs.readFileSync(new URL('../'+file,import.meta.url),'utf8');
const hub=read('js/admin-test-center.js'),admin=read('js/admin.js'),css=read('css/workspace-experience.css');
assert.doesNotThrow(()=>new vm.Script(hub));
assert.doesNotThrow(()=>new vm.Script(admin));
const validMerchant='11111111-1111-4111-8111-111111111111';
const validCustomer='22222222-2222-4222-8222-222222222222';
const htmlEscape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
let authorized=true,role='superadmin';
const searches=[],entities=[],controls=[],sections=[],handlers={},fields={};
const document={
  getElementById:id=>fields[id]||null,
  addEventListener:(name,fn)=>{handlers[name]=fn}
};
const context={
  document,adminReady:()=>authorized,adminCurrentRole:()=>role,
  adminRoleCanSection:()=>true,esc:htmlEscape,
  adminRuntime:{
    data:{
      merchants:[{id:validMerchant,name:'Barbearia & Associados <script>',status:'active'}]
    },
    searchQuery:'barbearia',
    searchPending:false,
    searchResults:[{type:'merchant',id:validMerchant,title:'Barbearia & Associados',subtitle:'São Gabriel'}]
  },
  adminRecentCustomers:()=>[{id:validCustomer,phone:'5555999991234',lastOrder:'TAM-2026-003',orders:2}],
  adminRunSearch:term=>searches.push(term),
  adminOpenEntity:(type,id)=>entities.push([type,id]),
  adminMerchantReturnToControls:id=>controls.push(id),
  adminSetSection:s=>sections.push(s)
};
vm.runInNewContext(hub+'\nthis.draw=adminTestCenterView;this.search=adminSupportHubSearch;',context);
const html=context.draw();
assert.match(html,/Localizar e ajudar alguém/);
assert.match(html,/admin-support-search/);
assert.match(html,/admin-support-results/);
assert.match(html,/data-admin-support-entity="merchant"/);
assert.match(html,/data-admin-support-entity="customer"/);
assert.match(html,/data-admin-support-merchant-controls=/);
assert.match(html,/final 1234/);
assert.doesNotMatch(html,/5555999991234/,'recent hub must not print full customer phone');
assert.doesNotMatch(html,/<script>/,'server-provided business name must be escaped');
assert.match(html,/Barbearia &amp; Associados &lt;script&gt;/);
assert.equal((html.match(/data-admin-official-page/g)||[]).length,19);
assert.equal((html.match(/data-admin-demo=/g)||[]).length,8);
assert.ok(html.indexOf('Localizar e ajudar alguém')<html.indexOf('Visitar as páginas oficiais'));
assert.ok(html.indexOf('Visitar as páginas oficiais')<html.indexOf('Testes isolados (opcional)'));
assert.match(html,/Serviços e agendamentos/);
assert.match(html,/Negócios e parceiros/);
assert.match(html,/Ajuda e informações/);
assert.match(css,/@media\(max-width:600px\)/);
assert.match(css,/admin-support-person-grid/);
assert.match(admin,/adminRuntime.section==='testcenter'\?'admin-support-search':'admin-global-search'/);
assert.match(admin,/sectionActive\('testcenter'\)\?'':adminGlobalSearchView\(\)/);
let prevented=false,focused=false;
fields['admin-support-search']={value:'  João & Cia  ',focus:()=>{focused=true}};
fields['admin-support-hub-feedback']={textContent:''};
assert.equal(context.search({preventDefault:()=>{prevented=true}}),false);
assert.equal(prevented,true);
assert.deepEqual(searches,['João & Cia']);
fields['admin-support-search'].value='a';
context.search({preventDefault(){}});
assert.equal(fields['admin-support-hub-feedback'].textContent,'Digite pelo menos dois caracteres para buscar.');
assert.equal(focused,true);
assert.deepEqual(searches,['João & Cia']);
fields['admin-support-search'].value='Cliente';
role='readonly';
context.search({preventDefault(){}});
assert.deepEqual(searches,['João & Cia']);
assert.equal(context.draw(),'','non-superadmin cannot access the hub');
role='superadmin';
authorized=false;
assert.equal(context.draw(),'','unauthenticated hub must be hidden');
context.search({preventDefault(){}});
assert.deepEqual(searches,['João & Cia']);
authorized=true;
const fake=(selector,attrs)=>({target:{closest:s=>s===selector?{
  getAttribute:key=>attrs[key]||null
}:null}});
handlers.click(fake('[data-admin-support-entity]',{'data-admin-support-entity':'merchant','data-admin-support-id':validMerchant}));
handlers.click(fake('[data-admin-support-entity]',{'data-admin-support-entity':'customer','data-admin-support-id':validCustomer}));
assert.deepEqual(entities,[['merchant',validMerchant],['customer',validCustomer]]);
handlers.click(fake('[data-admin-support-entity]',{'data-admin-support-entity':'invalid','data-admin-support-id':validMerchant}));
assert.equal(entities.length,2,'invalid entity type must never open privileged detail');
handlers.click(fake('[data-admin-support-merchant-controls]',{'data-admin-support-merchant-controls':validMerchant}));
assert.deepEqual(controls,[validMerchant]);
handlers.click(fake('[data-admin-test-section]',{'data-admin-test-section':'partners'}));
assert.deepEqual(sections,['partners']);
assert.doesNotMatch(hub,/setSession\(|service_role|fetch\(.*admin-token|impersonate/);
console.log('PASS V1.1061: real participant search, summarized activity, secure 360° routing, merchant controls, 19 official pages and optional demo.');
