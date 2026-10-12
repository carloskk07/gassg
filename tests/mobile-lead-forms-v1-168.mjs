import assert from 'node:assert/strict';
import fs from 'node:fs';
const source=fs.readFileSync(new URL('../js/acquisition.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../css/components.css',import.meta.url),'utf8');
const customerForm=source.slice(source.indexOf('function prelaunchCustomerLeadSection()'),source.indexOf('function submitPrelaunchCustomerLead()'));
assert.ok(customerForm.indexOf('id=\\"prelaunch-phone\\"')<customerForm.indexOf('id=\\"prelaunch-name\\"'),'WhatsApp must appear before optional name');
for(const fragment of ['customer-phone-hint','autocomplete=\\"tel\\"','aria-required=\\"true\\"','prelaunch-consent','prelaunch-postal','prelaunch-interest','prelaunch-website','prelaunch-submit']){
 assert.ok(customerForm.includes(fragment),'Missing buyer form security/accessibility element: '+fragment);
}
assert.ok(source.includes("if(!consent)return toast("),'Customer WhatsApp opt-in must remain explicit');
assert.ok(source.includes("if(postalCode.length!==8)"),'CEP validation must remain enforced');
assert.ok(source.includes("if(!interests.length)"),'Required interests must remain enforced');
assert.ok(css.includes('.lead-interests input:focus-visible+span'),'Keyboard selection must be visible');
assert.ok(css.includes('font-size:16px'),'iOS input text must not trigger zoom');
assert.ok(css.includes('.home-first-visit .starter-cta{min-height:54px}'),'Mobile first CTA should have sufficient tap target');
assert.ok(source.includes("leadType:'customer'")&&source.includes("leadType:'merchant'"),'Lead records must remain separated');
console.log('V1.168 mobile forms: lead privacy, WhatsApp-first, real CEP, keyboard navigation and partner form preserved.');
