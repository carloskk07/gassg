import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const act=read('js/admin-activations.js'),merchant=read('js/merchant.js');
const growth=read('js/growth.js');
for(const [file,source] of Object.entries({act,merchant,growth}))
  new vm.Script(source,{filename:file+'.js'});
function fragment(s,a,b){
 const x=s.indexOf(a),y=s.indexOf(b,x+a.length);
 assert.ok(x>=0&&y>x,'Missing code section: '+a);
 return s.slice(x,y);
}
const uuid='12345678-1234-4234-8234-123456789abc',dateFields=new Map();
const ctx=vm.createContext({
 Date:class extends Date{constructor(...args){super(...(args.length?args:['2026-11-09T12:00:00Z']));}},
 document:{getElementById:id=>dateFields.get(id)||null},
});
vm.runInContext(fragment(act,'// V1.910 — date choices are previews,','// V1.326 — manual return planning')+
 '\nthis.shortcuts={fill:adminAdsQuickReturnDate,options:adminAdsReturnDateOptions};',ctx);
let operations=0;
for(const prefix of ['ads-return','ads-contact']){
 const id=prefix+'-'+uuid+'-date';
 const date={value:'',disabled:false};dateFields.set(id,date);
 assert.match(ctx.shortcuts.options(id),/Escolher prazo, sem agendar automaticamente/);
 assert.equal(ctx.shortcuts.fill(id,3),true);
 assert.equal(date.value,'2026-11-12');
 assert.equal(ctx.shortcuts.fill(id,14),true);
 assert.equal(date.value,'2026-11-23');
 assert.equal(ctx.shortcuts.fill(id,'999'),false);
 assert.equal(date.value,'2026-11-23');
 date.disabled=true;
 assert.equal(ctx.shortcuts.fill(id,1),false);
 assert.equal(date.value,'2026-11-23');
}
assert.equal(ctx.shortcuts.fill('ads-return-evil-date',7),false);
assert.equal(ctx.shortcuts.fill('ads-contact-'+uuid+'-note',3),false);
assert.match(act,/adminAdsReturnDateOptions\('ads-contact-'\+id\+'-date'\)/);
assert.match(act,/adminAdsReturnDateOptions\('ads-return-'\+id\+'-date'\)/);
assert.match(act,/adminAdsContactRecord\(/);
assert.match(act,/adminAdsFeedbackReturnAction\(/);
assert.match(act,/sem enviar mensagem/i);

// The merchant's preset creates only an editable request. Sending still needs owner consent.
const help={value:'Anterior',disabled:false};
const mctx=vm.createContext({document:{getElementById:id=>id==='ads-help-note'?help:null}});
vm.runInContext(fragment(merchant,'// V1.910 — guidance-only drafts,','// V1.323 — request human advice')+
 '\nthis.help={choose:merchantAdsHelpChoose,templates:MERCHANT_ADS_HELP_CHOICES};',mctx);
assert.equal(mctx.help.choose('start'),true);
assert.equal(help.value,mctx.help.templates.start);
assert.ok(help.value.length>=20&&help.value.length<=240);
assert.equal(mctx.help.choose('price'),true);
assert.equal(help.value,mctx.help.templates.price);
assert.equal(mctx.help.choose('__proto__'),false);
assert.equal(mctx.help.choose('unknown'),false);
assert.equal(help.value,mctx.help.templates.price);
assert.match(merchant,/id="ads-help-channel"/);
assert.match(merchant,/id="ads-help-note"/);
assert.match(merchant,/merchantAdsHelpChoose\(this.value\)/);
assert.match(merchant,/id="ads-help-consent"/);
assert.match(merchant,/merchantAdsAssistanceAction\(\\'request\\'\)/);

// Referral and merchant scenario selectors are explicitly illustrative.
// Product cost is never silently invented to manufacture a positive margin.
for(const id of ['ref-sim-clients','ref-sim-ticket','merchant-sim-orders','merchant-sim-ticket'])
 assert.ok(growth.includes('<select id="'+id+'"'));
assert.match(growth,/value="10" selected>10<\/option>/);
assert.match(growth,/value="120" selected>120<\/option>/);
assert.match(growth,/value="50" selected>50<\/option>/);
assert.match(growth,/onchange="updateReferralSimulator\(\)"/);
assert.match(growth,/onchange="updateMerchantSimulator\(\)"/);
assert.match(growth,/id="merchant-sim-product-cost"/);
assert.match(growth,/Informe o custo do produto/);
assert.match(growth,/function updateMerchantSimulator\(/);
assert.match(growth,/function updateReferralSimulator\(/);
assert.equal(operations,0);
assert.match(read('.github/workflows/audit.yml'),/tests\/more-marked-fields-v1-910\.mjs/);
console.log('V1.910 PASS: Admin return dates, Merchant Ads help and both simulators; no silent financial or contact actions.');
