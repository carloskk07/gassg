import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// An isolated, browser-only presentation of the EXISTING application simulator.
// Never emit the commercial Supabase URL, keys, cloud origin or payment adapters.
const root=path.resolve(new URL('..',import.meta.url).pathname);
const output=path.resolve(root,process.argv[2]||'_site');
assert.ok(output!==root&&!root.startsWith(output+path.sep),'Refuse to overwrite source');
fs.rmSync(output,{recursive:true,force:true});
fs.mkdirSync(output,{recursive:true});
for(const dir of ['js','css','icons','assets']){
  const source=path.join(root,dir);
  assert.ok(fs.statSync(source).isDirectory(),'Missing canonical public assets: '+dir);
  fs.cpSync(source,path.join(output,dir),{recursive:true});
}
for(const name of ['index.html','manifest.webmanifest']){
  fs.copyFileSync(path.join(root,name),path.join(output,name));
}
const replaceOnce=(source,needle,replacement)=>{
  assert.equal(source.split(needle).length,2,'Canonical source changed; refuse unsafe demo build');
  return source.replace(needle,replacement);
};
// Force the deterministic simulator on ALL demo hostnames, never on tamao.com.br.
fs.writeFileSync(path.join(output,'js/runtime-config.js'),[
 "globalThis.CHAMA_CUSTOMER_ORIGIN='';",
 "globalThis.CHAMA_MERCHANT_ORIGIN='';",
 "globalThis.CHAMA_ADMIN_ORIGIN='';",
 "globalThis.CHAMA_TURNSTILE_SITE_KEY='';",
 "globalThis.CHAMA_PORTAL_ROLE='';",
 "globalThis.CHAMA_INTERNAL_PILOT=false;",
 "globalThis.__CHAMA_TEST__=true;",
 "globalThis.TAMAO_BROWSER_DEMO=true;",
 ""
].join('\n'));
const bpath=path.join(output,'js/backend.js');
let backend=fs.readFileSync(bpath,'utf8');
backend=replaceOnce(backend,
 "url:'https://lgugwujpunhslavewffd.supabase.co'",
 "url:'https://demo-no-backend.invalid'");
backend=replaceOnce(backend,
 "publishableKey:'sb_publishable_3FLGyrWHrUZ5vQc59Iowug_pekOZ9u_'",
 "publishableKey:'public-demo-disabled'");
fs.writeFileSync(bpath,backend);
const bootstrap=path.join(output,'js/bootstrap.js');
let js=fs.readFileSync(bootstrap,'utf8');
js=replaceOnce(js,
 "if('serviceWorker'in navigator&&location.protocol.startsWith('http')){",
 "if(false&&'serviceWorker'in navigator&&location.protocol.startsWith('http')){");
fs.writeFileSync(bootstrap,js);
// A human-facing demo must not look like an automated test runner.
const corePath=path.join(output,'js/core.js');
let core=fs.readFileSync(corePath,'utf8');
core=replaceOnce(core,'Ambiente isolado de teste automatizado',
 '🧪 Demonstração interativa • nenhum pedido ou pagamento real');
fs.writeFileSync(corePath,core);
// The canonical merchant copy describes a legally meaningful real acceptance.
// On a static fictitious demo this would be misleading; change only the copy
// emitted into the Pages artifact, not merchant.js in production.
const merchantPath=path.join(output,'js/merchant.js');
let merchant=fs.readFileSync(merchantPath,'utf8');
merchant=replaceOnce(merchant,'Aceitar significa assumir compromisso real de atendimento.',
  'Simulação: aceitar este pedido não cria venda, entrega ou compromisso real.');
fs.writeFileSync(merchantPath,merchant);
// Avoid existing production service workers and speculative third-party fetches.
const htmlPath=path.join(output,'index.html');
let html=fs.readFileSync(htmlPath,'utf8');
html=replaceOnce(html,
 "https://lgugwujpunhslavewffd.supabase.co wss://lgugwujpunhslavewffd.supabase.co https://challenges.cloudflare.com",
 "'none'");
html=replaceOnce(html,'content="index,follow,max-image-preview:large"',
 'content="noindex,nofollow,noarchive,nosnippet"');
html=replaceOnce(html,'<link rel="canonical" href="https://tamao.com.br/" />','');
html=replaceOnce(html,'<title>TAMÃO — Faltou em casa? Tá na mão.</title>',
 '<title>TAMÃO — Demonstração interativa (sem vendas reais)</title>');
html=replaceOnce(html,'<script defer src="./js/bootstrap.js"></script>',
 '<script defer src="./js/bootstrap.js"></script>\n  <script defer src="./js/demo-browser-panel.js"></script>');
html=replaceOnce(html,'<body>','<body>\n  <div id="tamao-demo-browser-banner" aria-label="Simulação sem vendas reais"></div>');
fs.writeFileSync(htmlPath,html);
fs.writeFileSync(path.join(output,'robots.txt'),'User-agent: *\nDisallow: /\n');
const manifestPath=path.join(output,'manifest.webmanifest');
const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
manifest.name='TAMÃO — Demonstração (dados fictícios)';
manifest.short_name='TAMÃO DEMO';
manifest.start_url='./#home';
manifest.scope='./';
fs.writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n');
fs.copyFileSync(path.join(root,'scripts/demo-browser-panel.js'),path.join(output,'js/demo-browser-panel.js'));

// Fail closed against accidentally copying any production project identifier,
// generated credentials or backend-specific environment files.
for(const file of ['index.html','js/runtime-config.js','js/backend.js','js/demo-browser-panel.js']){
  const content=fs.readFileSync(path.join(output,file),'utf8');
  assert.ok(!content.includes('lgugwujpunhslavewffd'),'Production Supabase leaked into '+file);
  assert.ok(!content.includes('sb_publishable_3FLGyrWHrUZ5vQc59Iowug_pekOZ9u_'),
    'Production publishable key leaked into '+file);
}
for(const forbidden of ['supabase','tests','scripts','.github','.env','.git','sw.js']){
  assert.ok(!fs.existsSync(path.join(output,forbidden)),'Private file deployed: '+forbidden);
}
assert.ok(html.includes('noindex,nofollow,noarchive,nosnippet'));
assert.ok(html.includes('js/demo-browser-panel.js'));
console.log('PASS: browser demo build contains only public site assets, simulator flag and disabled external backend; no Supabase/Pix integrations.');
