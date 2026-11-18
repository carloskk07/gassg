import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const qa=read('js/admin-test-center.js');
const demo=read('scripts/demo-browser-panel.js');
const builder=read('scripts/build-owner-browser-demo.mjs');
const html=read('index.html');
const flow=read('.github/workflows/owner-browser-demo-pages.yml');
new vm.Script(qa,{filename:'admin-test-center.js'});
new vm.Script(demo,{filename:'demo-browser-panel.js'});
const ctx={
 adminReady:()=>true,adminCurrentRole:()=> 'superadmin',
 adminRoleCanSection:()=>true,esc:s=>String(s)
};
vm.runInNewContext(qa+'\nthis.view=adminTestCenterView;',ctx);
const view=ctx.view();
assert.match(view,/Áreas oficiais do TAMÃO/);
assert.match(view,/Localizar e ajudar alguém/);
assert.match(view,/Configurações e suporte/);
assert.match(view,/admin-support-search/);
assert.match(view,/data-admin-official-page/);
assert.ok(view.indexOf('Áreas oficiais do TAMÃO')<view.indexOf('Testes isolados (opcional)'), 'official pages must come before the simulation');
assert.match(view,/Modo teste · dados fictícios/);
assert.match(view,/Testes isolados \(opcional\)/);
assert.match(view,/permissões e registros de auditoria/);
assert.match(view,/Financeiro e Pix/);
assert.equal((view.match(/data-admin-demo=/g)||[]).length,8);
for(const role of ['customer','tracking','merchant','driver','club','network','agenda','admin']){
 assert.ok(view.includes('https://carloskk07.github.io/gassg/?tamao_demo_role='+role),
  'Missing isolated one-click demo '+role);
}
assert.match(view,/<details class="admin-test-more"><summary>Testes isolados/);
assert.match(view,/data-admin-support-entity/);
assert.match(view,/https:\/\/parceiro\.tamao\.com\.br\//);
assert.doesNotMatch(view,/<a[^>]*data-admin-demo[^>]*href="https:\/\/parceiro\.tamao\.com\.br\//);
assert.doesNotMatch(view,/access_token|refresh_token|token=|service_role|signInWithOtp/);
ctx.adminCurrentRole=()=> 'readonly';assert.equal(ctx.view(),'');
ctx.adminCurrentRole=()=> 'superadmin';ctx.adminReady=()=>false;assert.equal(ctx.view(),'');
assert.match(demo,/function openDemoScenario\(role\)/);
assert.match(demo,/new URLSearchParams\(location\.search\)\.get\('tamao_demo_role'\)/);
assert.match(demo,/\['customer','tracking','merchant','driver','admin','club','network','agenda'\]/);
assert.match(demo,/function openDemoPreview\(type\)/);
assert.match(demo,/agendaDemoBooked/);
assert.match(demo,/Cancelar reserva/);
assert.match(demo,/Reservar horário/);
assert.doesNotMatch(demo,/fetch\(['"]https:\/\/lgugwujpunhslavewffd|service_role|generateLink|signInWithOtp/);
assert.match(builder,/demo-no-backend\.invalid/);
assert.match(builder,/globalThis\.__CHAMA_TEST__=true/);
assert.match(builder,/globalThis\.TAMAO_BROWSER_DEMO=true/);
assert.match(builder,/Never emit the commercial Supabase URL/);
assert.match(flow,/node tests\/browser-demo-journey\.mjs/);
assert.match(html,/<script defer src="\.\/js\/admin-test-center\.js"><\/script>/);
console.log('V1.1057 PASS: Admin test hub points to isolated, credential-free demo with 8 whitelisted scenarios; live links remain separate.');
