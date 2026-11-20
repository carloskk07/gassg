import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Current first-paint contract. The older V1.376 marketing copy was replaced
// by a lightweight preboot screen and a truthful regional quote-first home.
// Do not pin text from old marketing or the historical service-worker version.
const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const index=read('index.html');
const bootstrap=read('js/bootstrap.js');
const growth=read('js/growth.js');
const showcase=read('js/home-showcase.js');
const core=read('js/core.js');
const css=read('css/marketing-premium.css');
const sw=read('sw.js');

for(const [file,source] of Object.entries({bootstrap,growth,showcase,core}))
 new vm.Script(source,{filename:file+'.js'});

// The first HTML paint must identify the brand, report loading accessibly,
// avoid a false live offer and tell users when scripting is required.
assert.match(index,/<html lang="pt-BR">/);
assert.match(index,/<div id="app">\s*<section class="tamao-preboot"/);
assert.match(index,/aria-label="Carregamento inicial do TAMÃO"/);
assert.match(index,/<h1>Preparando o TAMÃO<\/h1>/);
assert.match(index,/role="status" aria-live="polite"/);
assert.match(index,/COTAÇÕES E SERVIÇOS DA SUA CIDADE/);
assert.match(index,/<noscript>.*Ative o JavaScript/s);
assert.ok(!index.includes('Pedidos garantidos'));
assert.doesNotMatch(index,/preboot[\s\S]*?revendas confirmadas para entrega imediata/,
 'the static shell cannot advertise invented supply');

// Public render is available at DOMContentLoaded, without waiting for images.
// Private login entry still handles the authenticated callback at load.
assert.match(bootstrap,/window\.addEventListener\('DOMContentLoaded',\(\)=>\{/);
assert.ok(bootstrap.includes("window.addEventListener('load',async()=>{"));
assert.match(bootstrap,/if\(globalThis\.merchantPortalRequested\?\.\(\)\)return;/);

// The current compact public navigation must retain accessible routes without
// promoting suspended lodging or duplicating many top-level menu buttons.
assert.match(core,/const primaryLinks=\[\['club','Clube'\],\['earn','Indicações'\]\]/);
assert.match(core,/tamao-public-header-groups/);
assert.match(core,/\['sponsors','Para marcas'\]/);
const publicNav=core.slice(core.indexOf('const primaryLinks='),core.indexOf('const switcher=',core.indexOf('const primaryLinks=')));
assert.ok(publicNav.length>100);
assert.doesNotMatch(publicNav,/hospedagens|lodging|['"]stay['"]/i);

// Regional offer cards require an authenticated fresh server snapshot, never
// convert reference gas prices to fictional merchants or fake sales.
for(const requirement of [
 'snapshot.real===true','snapshot.notAQuote===true',
 'snapshot?.source', 'real.slice(0,6)',
 'city-price-card verified',
 'Sem ofertas confirmadas'
]){
 assert.ok(showcase.includes(requirement),'missing regional price authority '+requirement);
}
assert.match(showcase,/const cards=real\.length\?liveCards:/);
assert.match(showcase,/O pedido só avança com uma revenda e um preço confirmados/);
assert.match(showcase,/A consulta não cria pedido|Escolha os produtos\. Confira preço e entrega pelo seu CEP/);
assert.match(showcase,/homeQuoteBasketMarkup/);
assert.match(showcase,/Ver cupons e Clube/);

// Seller-facing landing and sponsor landing each have a clear action and
// transparent commercial conditions, not an unverified purchase promise.
const sponsor=read('js/sponsors-premium.js');
const merchant=growth.slice(growth.indexOf('function merchantsLanding(){'),growth.indexOf('function merchantJoin(){'));
assert.match(growth,/function tamaoSponsorPremiumLoad/);
assert.match(growth,/sponsors-premium\.js/);
assert.match(sponsor,/sponsor-premium-hero/);
assert.match(sponsor,/PUBLICIDADE IDENTIFICADA/);
assert.match(sponsor,/sponsor-premium-faq/);
assert.equal((sponsor.match(/class="sponsor-format-grid"/g)||[]).length,1);
for(const type of ['relationship','local'])
 assert.ok(sponsor.includes("openSponsorContact('"+type+"')"));
assert.ok(sponsor.includes("Criar anúncio da minha empresa")&&sponsor.includes("sponsorJumpTo('sponsor-pricing')"),
 'Direct advertiser creation must not detour through generic contact');
assert.match(sponsor,/Apresentação ilustrativa, não é anúncio publicado/);
assert.match(sponsor,/inventário disponível/,
 'A divulgação não pode prometer inventário inexistente');
assert.match(merchant,/merchant-conversion-start/);
assert.equal((merchant.match(/prelaunchMerchantLeadSection\(\)/g)||[]).length,1);
assert.match(merchant,/Você controla preços, estoque, pagamentos e entregas/,
 'A revenda mantém autonomia comercial mesmo com copy mais acolhedora');
const rail=merchant.slice(merchant.indexOf('merchant-jump-rail'),merchant.indexOf('merchant-cro-steps'));
assert.equal((rail.match(/<button type="button"/g)||[]).length,2);
assert.match(rail,/publicLandingJump\('merchant-margin'\)/);
assert.match(rail,/publicLandingJump\('merchant-how'\)/);

// Mobile and keyboard accessibility are part of first-impression quality.
for(const token of [
 '.tamao-preboot','.city-price-reference-summary','.merchant-jump-rail',
 '@media(max-width:620px)',':focus-visible'
])assert.ok(css.includes(token),'missing visible/mobile style '+token);
const cacheVersion=/const CACHE='tamao-sg-v1\.(\d+)'/.exec(sw);
assert.ok(cacheVersion&&Number(cacheVersion[1])>=370,
 'the service worker must version the public shell');
assert.match(sw,/\.\/js\/runtime-config\.js/);
assert.match(sw,/\.\/css\/marketing-premium\.css/);
console.log('PASS: current public first paint, regional offer truth, compact navigation, sponsor/merchant CTAs, keyboard/mobile styles and versioned cache.');
