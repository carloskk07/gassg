import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const out=path.resolve('_site');
const workflow=fs.readFileSync(new URL('../.github/workflows/owner-browser-demo-pages.yml',import.meta.url),'utf8');
const pushPaths=workflow.split('  push:')[1]?.split('  workflow_dispatch:')[0]||'';
for(const asset of ["'js/**'","'css/**'","'index.html'","'icons/**'","'assets/**'","'manifest.webmanifest'"]){
 assert.ok(pushPaths.includes(asset),'GitHub Pages must republish when '+asset+' changes on main');
}

const read=name=>fs.readFileSync(path.join(out,name),'utf8');
const h=read('index.html');
const runtime=read('js/runtime-config.js');
const backend=read('js/backend.js');
const panel=read('js/demo-browser-panel.js');
assert.ok(h.includes('noindex,nofollow,noarchive,nosnippet'));
assert.ok(h.includes('Demonstração interativa (sem vendas reais)'));
assert.ok(h.includes('<script defer src="./js/demo-browser-panel.js"></script>'));
assert.ok(h.includes('connect-src \'self\' \'none\''),'No remote fetches allowed by CSP');
assert.ok(!h.includes('<link rel="canonical" href="https://tamao.com.br/"'));
assert.ok(runtime.includes("globalThis.__CHAMA_TEST__=true;"));
assert.ok(runtime.includes("globalThis.TAMAO_BROWSER_DEMO=true;"));
assert.ok(runtime.includes("globalThis.CHAMA_INTERNAL_PILOT=false;"));
assert.ok(backend.includes("url:'https://demo-no-backend.invalid'"));
assert.ok(backend.includes("publishableKey:'public-demo-disabled'"));
assert.ok(!backend.includes('lgugwujpunhslavewffd'));
assert.ok(!backend.includes('sb_publishable_'));
assert.ok(panel.includes('Admin (resumo)'));
assert.ok(panel.includes('Revenda (pedido)'));
assert.ok(panel.includes('Começar com gás P13'));
assert.ok(panel.includes('Cliente · acompanhar pedido'));
assert.ok(panel.includes('setModeOriginal(mode)'));
assert.ok(panel.includes("mode==='customer'&&currentOrder()"));
assert.ok(panel.includes("globalThis.go?.('tracking')"));
assert.ok(panel.includes("startOrder?.('P13')"));
assert.ok(panel.includes('currentOrder()'));
assert.ok(panel.includes('1/4 · Cliente'));
assert.ok(panel.includes('s.selectedMerchant=o.merchantId'));
assert.ok(panel.includes('focusAssignedOrder'));
assert.ok(read('js/core.js').includes('Demonstração interativa • nenhum pedido ou pagamento real'));
assert.ok(!read('js/core.js').includes('Ambiente isolado de teste automatizado'));
assert.ok(read('js/merchant.js').includes('Simulação: aceitar este pedido não cria venda, entrega ou compromisso real.'));
assert.ok(!read('js/merchant.js').includes('Aceitar significa assumir compromisso real de atendimento.'));


assert.ok(panel.includes('Continuar na Revenda'));
assert.ok(panel.includes('sem cadastro, Pix ou cobrança real'));
assert.ok(panel.includes('ChamaTest?.getState'));
assert.ok(read('robots.txt').includes('Disallow: /'));
assert.ok(!read('js/bootstrap.js').includes("if('serviceWorker'in navigator&&location.protocol.startsWith('http')){"));
for(const file of ['index.html','js/runtime-config.js','js/backend.js','js/core.js','js/customer.js','js/merchant.js','js/bootstrap.js',
 'js/demo-browser-panel.js','css/base.css','css/components.css','icons/icon.svg','manifest.webmanifest']){
 assert.ok(fs.statSync(path.join(out,file)).isFile(),'Missing public demo asset: '+file);
}
for(const dir of ['supabase','tests','scripts','.github','.git','.env','sw.js']){
 assert.ok(!fs.existsSync(path.join(out,dir)),'Private source in site: '+dir);
}
console.log('PASS: hosted demo loads canonical UI with browser simulation, no live backend or Supabase URL, no service worker, noindex and admin read-only summary.');
