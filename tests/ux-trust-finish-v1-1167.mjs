import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const components=read('css/components.css');
const core=read('js/core.js');
const publicUX=read('css/public-ux.css');
const sponsor=read('js/sponsors-premium.js');
const club=read('js/club-premium.js');
const clubCSS=read('css/club-premium.css');
const home=read('js/home-showcase.js');
const boot=read('js/bootstrap.js');

for(const [file,source] of [['js/core.js',core],['js/sponsors-premium.js',sponsor],['js/club-premium.js',club],['js/home-showcase.js',home]]){
 new vm.Script(source,{filename:file});
}

// No fixed CTA may float over product buttons, search forms, merchant rates or benefit cards.
assert.match(components,/\.tamao-help-shortcut\{\s*position:relative/);
assert.doesNotMatch(components,/\.tamao-help-shortcut\{position:fixed/);
assert.match(components,/\.tamao-help-shortcut:focus-visible\{outline:/);
assert.match(components,/\.tamao-help-shortcut::before/);
assert.match(components,/@media\(max-width:759px\)\{\.tamao-help-shortcut\{/);
assert.match(core,/tamao-help-shortcut.*tamao_help=\$\{merchantPortal\?'revenda':'cliente'\}/);
assert.match(core,/modulo=\$\{encodeURIComponent\(r\)\}#contact/);
assert.match(core,/\$\{siteFooter\(\{adminPortal\}\)\}/);

// The sponsor's illustrative placement must not use skeleton-loader bars.
assert.match(sponsor,/class="sponsor-preview-pills"><span>Região<\/span><span>Produtos<\/span><span>Serviços<\/span>/);
assert.match(sponsor,/class="sponsor-preview-after" aria-hidden="true"><span>Marca identificada<\/span><span>Condições transparentes<\/span><span>Revisão antes de publicar<\/span>/);
assert.doesNotMatch(sponsor,/class="sponsor-preview-pills"><span><\/span><span><\/span><span><\/span>/);
assert.doesNotMatch(sponsor,/class="sponsor-preview-after" aria-hidden="true"><span><\/span>/);
assert.match(publicUX,/V1\.1167 — the sponsor preview describes placements/);
assert.match(publicUX,/\.sponsor-preview-pills span,\s*\.sponsor-premium-v1090 \.sponsor-preview-pills span:first-child/);
assert.match(publicUX,/\.sponsor-preview-after span:nth-child\(3\)/);
assert.match(sponsor,/Apresentação ilustrativa, não é anúncio publicado/);
assert.match(sponsor,/Localização e exibição dependem de revisão e inventário disponível/);
assert.match(sponsor,/R\$ 0,02 por visualização elegível/);
assert.match(sponsor,/Recargas a partir de R\$ 19,90/);

// Credibility without false coupons or overpromising benefits.
assert.match(club,/<h1>Cupons e cashback\.<em> Benefícios claros no Clube TAMÃO\.<\/em><\/h1>/);
assert.doesNotMatch(club,/Suas compras podem render muito mais no Clube TAMÃO/);
assert.match(club,/Cupons e cashback dependem de regras, disponibilidade e validações próprias/);
assert.match(club,/class="tamao-coupon-price-board card form-stack" hidden/);
assert.match(club,/data-coupon-price/);
assert.match(club,/onsubmit="return tamaoWelcomeRegister\(event\)"/);
assert.match(club,/name="full_name"/);
assert.match(club,/name="phone"/);
assert.match(club,/name="email"/);
assert.match(clubCSS,/V1\.1167 — the Club's value proposition/);
assert.match(clubCSS,/@media\(min-width:741px\)/);
assert.match(clubCSS,/club-premium-entry-card \.tamao-club-access label\{font-size:12px\}/);

// No fabricated prices, merchants, counts or live availability in a known empty state.
assert.match(home,/Disponibilidade em '\+esc\(place\)\+': ainda sem ofertas confirmadas/);
assert.match(home,/O pedido só avança quando houver revenda e preço confirmados/);
assert.match(home,/No indicative prices without verified supply/);
assert.match(boot,/function render\(/);

console.log('V1.1167 PASS — no overlaying help button, honest ad preview, legible Club and verified stock-free Home');
