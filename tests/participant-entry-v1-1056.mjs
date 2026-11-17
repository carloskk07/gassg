import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const html=read('index.html');
const css=read('css/public-ux.css');
const core=read('js/core.js');
const bootstrap=read('js/bootstrap.js');
const builder=read('scripts/build-live-portals.mjs');
const m=html.match(/<template id="tamao-participant-access-template">([\s\S]*?)<\/template>/);
assert.ok(m,'Acesso dos participantes precisa estar presente na home');
const menu=m[1];
assert.match(menu,/<summary aria-label="Escolher minha área no TAMÃO">/);
assert.match(menu,/Seu espaço no TAMÃO/);
assert.match(menu,/Para você/);
assert.match(menu,/Para seu negócio/);
for(const [href,label] of [
 ['#club','Minha conta e Clube'],
 ['#earn','Minha Rede'],
 ['/agenda/','Minha agenda'],
 ['https://parceiro.tamao.com.br/','Revenda ou entregador'],
 ['#advertise','Anunciante']
]){
 assert.ok(menu.includes('href="'+href+'"'),href+' não encontrado');
 assert.ok(menu.includes('<strong>'+label+'</strong>'),label+' não encontrado');
}
assert.equal((menu.match(/class="tamao-account-entry(?: tamao-account-entry-primary)?"/g)||[]).length,5);
assert.doesNotMatch(menu,/admin\.tamao\.com\.br|Administraç|superadmin|painel administrativo/i,
 'Admin não deve estar na navegação pública');
assert.match(core,/accountAccess=adminPortal\|\|merchantPortal\|\|testDemo\?'':/);
assert.match(bootstrap,/'privacy','terms'\]\.includes\(page\)/);
assert.match(css,/@media\(max-width:759px\)/);
assert.match(css,/@media\(max-width:390px\)/);
assert.match(css,/tamao-account-entry:focus-visible/);
assert.match(css,/\.tamao-account-access-panel\{[^}]*max-width:calc\(100vw - 24px\)/);
assert.match(builder,/role==='customer'/);
console.log('V1.1056 PASS: menu de entrada com cinco áreas, sem Admin público, estilos e navegação acessível.');
