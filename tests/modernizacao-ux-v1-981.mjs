import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const [home,core,growth,bootstrap,marketing,workspace,audit]=[
 'js/home-showcase.js','js/core.js','js/growth.js','js/bootstrap.js',
 'css/marketing-premium.css','css/workspace-experience.css','.github/workflows/audit.yml'
].map(read);
for(const [name,source] of [['home',home],['core',core],['growth',growth],['bootstrap',bootstrap]])
 assert.doesNotThrow(()=>new vm.Script(source,{filename:name+'.js'}));
assert.match(home,/Sem ofertas confirmadas em /);
assert.match(home,/pedido só avança com uma revenda e um preço confirmados/);
assert.match(home,/onclick="homeDiscoverFocus\(\)">Ver produtos/);
assert.match(home,/public_city_price_board_v1_341/);
assert.doesNotMatch(home,/Sem ofertas confirmadas[^\n]*R\$\s*115/i);
assert.match(marketing,/#tamao-main h1\[tabindex="-1"\]:focus:not\(:focus-visible\)\{outline:none\}/);
assert.match(marketing,/#tamao-main h1\[tabindex="-1"\]:focus-visible\{outline:3px solid/);
assert.match(marketing,/\.tamao-quote-no-offer \.city-price-empty/);
assert.match(marketing,/\.merchant-landing-premium \.page-title\{font-size:clamp/);
assert.match(growth,/Sua revenda mais visível\. <span class="headline-accent">Mais oportunidades de pedidos/);
assert.match(growth,/Você controla preços, estoque, recebimento e entrega/);
assert.match(core,/aria-current="'\+\(r===id\?'page':'false'\)/);
assert.match(core,/Painel da revenda • acesso seguro por e-mail/);
assert.match(core,/Admin • acesso por e-mail autorizado/);
assert.doesNotMatch(core,/control plane server-side|autenticação permanente necessária/);
assert.match(bootstrap,/A modalidade de hospedagens está suspensa/);
assert.doesNotMatch(bootstrap,/Cadastre seus serviços, caronas e hospedagens/);
assert.match(workspace,/\.admin-page \.admin-task-navigator\{padding:9px 12px/);
assert.match(audit,/node tests\/modernizacao-ux-v1-981\.mjs/);
console.log('V1.981 PASS: real supply boundaries, route-focus accessibility, public conversion and protected portal copy.');
