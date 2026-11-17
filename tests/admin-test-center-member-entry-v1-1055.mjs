import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const admin=read('js/admin.js');
const qa=read('js/admin-test-center.js');
const core=read('js/core.js');
const html=read('index.html');
const marketing=read('css/public-ux.css');
const workspace=read('css/workspace-experience.css');
const entry=read('index.html');
const builder=read('scripts/build-live-portals.mjs');
const serviceWorker=read('sw.js');

for(const [name,source] of Object.entries({admin,qa,core}))
  assert.doesNotThrow(()=>new vm.Script(source,{filename:name+'.js'}));

// The QA center exists only for verified superadmins, never anonymous or readonly.
const aclSource=admin.slice(admin.indexOf('const ADMIN_SECTION_ROLES='),admin.indexOf('function adminRelativeTime('));
const roles={adminCurrentRole:()=> 'superadmin',adminRuntime:{section:'overview'}};
vm.runInNewContext(aclSource+'\nthis.can=adminRoleCanSection;',roles);
assert.equal(roles.can('testcenter','superadmin'),true);
for(const role of ['readonly','finance','operations','support','compliance','anonymous'])
  assert.equal(roles.can('testcenter',role),false);
assert.match(admin,/adminMenuButton\('testcenter','Testar páginas'/);
assert.match(admin,/adminPanel\('testcenter',sectionActive\('testcenter'\)/);
assert.match(admin,/const allowed=\['overview','testcenter','orders'/);
assert.match(admin,/adminRoleCanSection\(requested\)/);

let permitted=true,role='superadmin';
const accessed=[];
const ctx={
  adminReady:()=>permitted,adminCurrentRole:()=>role,
  adminRoleCanSection:section=>roles.can(section,role),
  esc:value=>String(value),
  adminSetSection:section=>accessed.push(section)
};
vm.runInNewContext(qa+'\nthis.view=adminTestCenterView;',ctx);
let panel=ctx.view();
assert.match(panel,/Central de testes/);
assert.match(panel,/Testar sem fazer outro login/);
assert.match(panel,/tamao_demo_role=customer/);
assert.match(panel,/tamao_demo_role=merchant/);
assert.match(panel,/tamao_demo_role=driver/);
assert.match(panel,/Ambiente demonstrativo/);
assert.match(panel,/Conferir páginas reais do site/);
for(const item of ['Home e produtos','Minha conta e Clube','Rede e indicações',
  'Agenda','Moto e carro','Caronas','Publicidade','Portal da revenda'])
  assert.ok(panel.includes(item),'QA center must include '+item);
assert.match(panel,/target="_blank" rel="noopener noreferrer"/);
assert.doesNotMatch(qa,/setSession|access_token|impersonat\w*\s*\(|service_role|signInWithPassword|paymentCreated/);
role='readonly';assert.equal(ctx.view(),'');
role='superadmin';permitted=false;assert.equal(ctx.view(),'');
permitted=true;

const registered={};
const withDocument={...ctx,document:{addEventListener:(type,callback)=>{registered[type]=callback}}};
vm.runInNewContext(qa,withDocument);
assert.equal(typeof registered.click,'function');
registered.click({target:{closest:()=>({getAttribute:()=> 'orders'})}});
assert.deepEqual(accessed,['orders']);
registered.click({target:{closest:()=>({getAttribute:()=> 'evil'})}});
assert.deepEqual(accessed,['orders']);
role='readonly';
registered.click({target:{closest:()=>({getAttribute:()=> 'finance'})}});
assert.deepEqual(accessed,['orders']);

// Public shell shows a visible entrance on every customer page, including mobile.
const start=core.indexOf('function shell(content){');
const end=core.indexOf('// V1.985: close desktop disclosures',start);
assert.ok(start>=0&&end>start);
const customer={
  route:()=> 'home',runtimeStrip:()=>'',siteFooter:()=>'',bottomNav:()=>'',esc:String,
  adminPortalRequested:()=>false,merchantPortalRequested:()=>false,
  __CHAMA_TEST__:false,liveRuntime:{},
  document:{getElementById:()=>({innerHTML:entry.match(/<template id="tamao-participant-access-template">([\s\S]*?)<\/template>/)?.[1]||''})}
};
vm.runInNewContext(core.slice(start,end)+'\nthis.draw=shell;',customer);
const result=customer.draw('CONTEUDO');
assert.match(result,/tamao-account-access/);
assert.match(entry,/id="tamao-participant-access-template"/);
assert.match(result,/Escolher minha área no TAMÃO/);
assert.match(result,/Minha conta e Clube/);
assert.match(result,/parceiro\.tamao\.com\.br/);
assert.match(result,/href="\/agenda\/"/);
assert.match(result,/Anunciante/);
assert.doesNotMatch(result,/Administração|href="https:\/\/admin\.tamao\.com\.br\/"/);
assert.match(result,/Seu espaço no TAMÃO/);
assert.match(result,/Minha agenda/);
customer.adminPortalRequested=()=>true;
assert.doesNotMatch(customer.draw('CONTEUDO'),/tamao-account-access/);
customer.adminPortalRequested=()=>false;
customer.merchantPortalRequested=()=>true;
assert.doesNotMatch(customer.draw('CONTEUDO'),/tamao-account-access/);
assert.match(core,/p\.contains\(event\.target\)/);
assert.match(marketing,/@media\(max-width:759px\).*tamao-account-access/s);
assert.match(marketing,/tamao-account-entry:focus-visible/);
assert.match(workspace,/admin-test-links/);

// Admin QA code stays out of public and merchant deployment bundles.
assert.match(html,/<script defer src="\.\/js\/admin-test-center\.js"><\/script>/);
assert.match(serviceWorker,/'\.\/js\/admin-test-center\.js'/);
assert.match(builder,/for\(const module of \['admin-acquisition','admin','admin-test-center','admin-activations'\]\)/);
assert.match(builder,/for\(const module of \['admin-acquisition','admin','admin-test-center','admin-activations','admin-ads-independent'\]\)/);

console.log('V1.1055: controlled Admin QA navigation + accessible participant login passed.');
