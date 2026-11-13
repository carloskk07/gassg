import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const admin=read('js/admin.js');
const acquisition=read('js/admin-acquisition.js');
const browser=read('tests/isolated-authenticated-screens-v1-973.mjs');
const audit=read('.github/workflows/audit.yml');
new vm.Script(admin,{filename:'js/admin.js'});
new vm.Script(acquisition,{filename:'js/admin-acquisition.js'});
const extract=(src,start,end)=>{
 const a=src.indexOf(start),b=src.indexOf(end,a+start.length);
 assert.ok(a>=0&&b>a,'Missing bounds '+start);
 return src.slice(a,b);
};
const adm=vm.createContext({
 adminRuntime:{searchResults:[],searchQuery:'',searchPending:false},
 adminNavIcon:()=>'<svg aria-hidden="true"></svg>',
 esc:s=>String(s).replaceAll('"','&quot;')
});
vm.runInContext(extract(admin,'function adminGlobalSearchView(){','function adminTimeline(')+
 '\nthis.search=adminGlobalSearchView;',adm);
const html=adm.search();
assert.match(html,/<input id="admin-global-search"[^>]*type="search"/);
assert.match(html,/<input id="admin-global-search"[^>]*aria-label="Buscar pedido, telefone, CNPJ, revenda ou cliente"/);
assert.match(html,/onclick="adminSearchFromUi\(\)"/);
const ctx=vm.createContext({adminCurrentRole:()=> 'superadmin',esc:s=>String(s)});
vm.runInContext(extract(acquisition,'function adminPublicRequestActionButtons(x){',
 'async function adminSetPublicRequestStatus(')+
 '\nthis.actions=adminPublicRequestActionButtons;',ctx);
const id='00000000-0000-4000-8000-000000000123';
const controls=ctx.actions({id,status:'new',request_kind:'merchant'});
const key='admin-public-note-'+id;
assert.ok(controls.includes('<label for="'+key+'">Observação adicional (opcional)</label>'));
assert.ok(controls.includes('<textarea id="'+key+'"'));
assert.match(controls,/<summary>Detalhes adicionais \(opcional\)<\/summary>/);
assert.match(controls,/Confirmei o resultado nos registros reais/);
assert.match(controls,/Selecione a providência realmente realizada/);
assert.equal(ctx.actions({id,status:'closed',request_kind:'merchant'}),'');
assert.match(browser,/unnamedInputs/);
assert.match(audit,/node tests\/authenticated-form-labels-v1-975.mjs/);
console.log('V1.975 PASS: global search and optional public-request notes have accessible labels; consent/decision controls preserved.');
