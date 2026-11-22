import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const js=read('js/learn-premium.js'),css=read('css/learn-premium.css');
new vm.Script(js,{filename:'js/learn-premium.js'});
const context=vm.createContext({shell:html=>html});
vm.runInContext(js+'\nthis.renderLearn=learnPremiumPage',context);
const page=context.renderLearn();
// V1.1133 introduced its dedicated guide and improved navigation; V1.1134
// replaces the illustrative art without dropping those functional contracts.
assert.match(page,/class="learn-guided-tour" id="learn-guided-tour" tabindex="-1"/);
assert.match(page,/learnPremiumJump\('learn-guided-tour'\)/);
assert.match(js,/\['learn-confidence','learn-benefits','learn-guided-tour'\]/);
assert.match(page,/id="learn-faq-search"/);
assert.match(page,/data-learn-stage-cta-label/);
assert.equal((page.match(/class="learn-step"/g)||[]).length,4);
assert.equal((page.match(/data-learn-scene="[1-4]"/g)||[]).length,4);
assert.equal((page.match(/class="learn-trust-path"/g)||[]).length,3);
assert.match(page,/COMPROMISSO COM A CLAREZA/);
assert.match(page,/onclick="go\('privacy'\)"/);
assert.match(page,/onclick="go\('terms'\)"/);
assert.match(page,/onclick="go\('contact'\)"/);
assert.match(css,/\.learn-premium \.learn-guided-tour/);
assert.doesNotMatch(js,/fetch\(|localStorage|XMLHttpRequest|sendBeacon/);
console.log('TAMÃO V1.1133 contract PASS: guide, navigation, trust and stages retained under V1.1134 visual replacement');
