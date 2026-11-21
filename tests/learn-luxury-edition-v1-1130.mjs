import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const css=read('css/learn-premium.css');
const js=read('js/learn-premium.js');
new vm.Script(js,{filename:'js/learn-premium.js'});
const context=vm.createContext({shell:x=>x});
vm.runInContext(js+'\nthis.page=learnPremiumPage;',context);
const page=context.page();

// No added claims, fabricated checkout, fake trust indicators or remote assets.
assert.equal((page.match(/class="learn-step"/g)||[]).length,4);
assert.equal((page.match(/data-learn-scene="\d"/g)||[]).length,4);
assert.match(page,/Simples para pedir/);
assert.match(page,/Claro para acompanhar/);
assert.match(page,/código de recebimento/);
assert.match(page,/A revenda precisa aceitar para confirmar o pedido/);
assert.match(page,/aria-label="Explorar as etapas do pedido"/);
assert.match(page,/learnPremiumStageAction\(\)/);
assert.match(page,/id="learn-faq-search"/);
assert.match(page,/onclick="go\('contact'\)"/);
assert.match(page,/onclick="go\('club'\)"/);
assert.match(page,/onclick="go\('earn'\)"/);
assert.doesNotMatch(page,/mais de \d+ clientes|entrega garantida|5 estrelas|R\$\s?\d+,\d\d/i);
assert.doesNotMatch(css,/@import\s|url\(\s*["']?https?:\/\//i);

// Single final art direction instead of unbounded successive overrides.
assert.equal((css.match(/V1\.1130 luxury edition/g)||[]).length,1);
assert.doesNotMatch(css,/\/\* V1\.1129 · editorial signature/);
assert.ok(css.includes('replace V1.1129 rather than stacking another stylesheet'));
for(const rule of [
 '--learn-ivory:#fafaf4','--learn-forest:#0b4233',
 'font-family:Georgia', 'font-style:italic',
 '.learn-premium .learn-hero .learn-eyebrow',
 '.learn-premium .learn-visual',
 '.learn-premium .learn-visual-next',
 '.learn-premium .learn-step-grid{grid-template-columns:repeat(2,minmax(0,1fr))',
 '.learn-premium .learn-step::before{display:none}',
 '.learn-premium .learn-step:hover{transform:none',
 '.learn-premium .learn-trust-strip',
 '.learn-premium .learn-faq-heading h2 em',
 '@media(max-width:900px)','@media(max-width:700px)','@media(max-width:420px)',
 '@media(prefers-reduced-motion:reduce)'
])assert(css.includes(rule),'Missing luxury composition: '+rule);

assert.ok(css.includes('border-top:1px solid #dbe6d9'),'editorial timeline must have a distinct hairline');
assert.ok(css.includes('background:transparent'),'avoid heavy repeated backgrounds');
assert.ok(css.includes('border-radius:22px'),'mobile cover must retain balanced corners');
console.log('TAMÃO V1.1130 PASS: restrained luxury, truthful copy, original interactive journeys, mobile accessibility and CSS consolidation.');
