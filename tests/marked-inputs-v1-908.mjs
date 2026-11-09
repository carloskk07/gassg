import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const admin=read('js/admin.js'), acquisition=read('js/admin-acquisition.js');
const merchant=read('js/merchant.js'), customer=read('js/customer.js');
const discovery=read('js/discovery.js'), build=read('scripts/build-live-portals.mjs');
for(const [name,src] of Object.entries({admin,acquisition,merchant,customer,discovery}))
  new vm.Script(src,{filename:name+'.js'});
const slice=(src,start,end)=>{
 const a=src.indexOf(start),b=src.indexOf(end,a+start.length);
 assert.ok(a>=0&&b>a,'missing region '+start);
 return src.slice(a,b);
};
const fields=new Map();
const ctx=vm.createContext({document:{getElementById:id=>fields.get(id)||null}});
vm.runInContext(slice(admin,'// V1.908 — shortcuts only fill inputs;','// V1.907 — notes selected during Clube')+
 '\nthis.preset={choose:adminClubeAmountChoose,view:adminClubeAmountChoices};',ctx);
const inputTopup={value:'',disabled:false},inputMin={value:'50,00',disabled:false};
fields.set('adminClubeSponsorTopupValue',inputTopup);
fields.set('adminClubeGeneralMinimumValue',inputMin);
assert.match(ctx.preset.view('adminClubeSponsorTopupValue'),/R\$ 100/);
assert.match(ctx.preset.view('adminClubeGeneralMinimumValue'),/R\$ 80/);
assert.equal(ctx.preset.view('bad-amount'),'');
assert.equal(ctx.preset.choose('adminClubeSponsorTopupValue','100'),true);
assert.equal(inputTopup.value,'100,00');
assert.equal(ctx.preset.choose('adminClubeGeneralMinimumValue','80'),true);
assert.equal(inputMin.value,'80,00');
assert.equal(ctx.preset.choose('adminClubeSponsorTopupValue','20000'),false);
assert.equal(ctx.preset.choose('__proto__','100'),false);
assert.equal(inputTopup.value,'100,00');
inputMin.disabled=true;
assert.equal(ctx.preset.choose('adminClubeGeneralMinimumValue','100'),false);
assert.equal(inputMin.value,'80,00');
assert.match(acquisition,/adminClubeAmountChoices\('adminClubeGeneralMinimumValue'\)/);
assert.match(acquisition,/adminClubeAmountChoices\('adminClubeSponsorTopupValue'\)/);
assert.match(acquisition,/adminClubeSponsorTopupFromUi\(\)/);
assert.match(acquisition,/adminClubeGeneralMinimumFromUi\(\)/);
assert.match(acquisition,/clube-sponsor-topup/);
assert.match(acquisition,/clube-general-minimum-set/);

vm.runInContext(slice(merchant,'// V1.908 — stock choices are drafts;', 'function merchantQuickStockAdjust(')+
 '\nthis.stock={choose:merchantNewStockQuick,view:merchantNewStockOptions};',ctx);
for(const id of ['live-new-registry-stock','live-new-glp-stock','live-new-container-stock']){
 const field={value:'0',disabled:false};fields.set(id,field);
 assert.match(ctx.stock.view(id),/Marque a quantidade conferida/);
 assert.equal(ctx.stock.choose(id,'25'),true);
 assert.equal(field.value,'25');
 assert.equal(ctx.stock.choose(id,'99999'),false);
 assert.equal(field.value,'25');
 assert.ok(merchant.includes('merchantNewStockOptions('));
 assert.ok(merchant.includes(id));
}
assert.equal(ctx.stock.choose('wrong-stock','5'),false);
const locked=fields.get('live-new-glp-stock');locked.disabled=true;
assert.equal(ctx.stock.choose('live-new-glp-stock','10'),false);
assert.equal(locked.value,'25');
for(const fn of ['merchantLiveAddRegisteredProduct','merchantLiveAddGlp','merchantLiveAddContainer'])
 assert.match(merchant,new RegExp('(?:async )?function '+fn+'\\('));

const care=slice(customer,'function liveCustomerCareBlock(o){', 'async function submitDeliveryFeedbackFromUi(');
assert.match(care,/id="support-category"/);
assert.match(care,/id="support-note-choice"/);
assert.match(care,/Sem recado adicional/);
assert.match(care,/Conferir andamento/);
assert.match(care,/Consultar soluções/);
assert.match(care,/Escrever recado diferente/);
assert.match(care,/id="support-message"/);
assert.match(care,/openSupportCaseFromUi\(\)/);
assert.match(customer,/await liveOpenSupportCase\(category,message\)/);

let kind='rides';
const esc=x=>String(x??'').replace(/[&<>"']/g,ch=>({
 '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
})[ch]);
const dctx={Date,URL,URLSearchParams,console,esc,shell:x=>x,route:()=>kind,
 BRL:new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}),
 CHAMA_BACKEND:{url:'https://sandbox.test',publishableKey:'test'},
 location:{origin:'https://tamao.com.br',search:'',hash:'#rides'}};
dctx.globalThis=dctx;
vm.runInNewContext(discovery,dctx);
dctx.discoveryState('rides').status='ready';
dctx.discoveryState('stays').status='ready';
const rides=dctx.discoveryPage();
assert.match(rides,/<select id="discovery-min-seats">/);
assert.match(rides,/<option value="">Qualquer quantidade<\/option>/);
assert.match(rides,/<option value="8"[^>]*>8 vaga\(s\)<\/option>/);
assert.doesNotMatch(rides,/<option value="9"[^>]*>9 vaga\(s\)<\/option>/);
dctx.discoveryState('rides').minSeats='3';
assert.match(dctx.discoveryPage(),/<option value="3" selected>3 vaga\(s\)<\/option>/);
kind='stays';
const stays=dctx.discoveryPage();
assert.match(stays,/Hospedagens temporariamente indisponíveis/);
assert.doesNotMatch(stays,/<select id="discovery-guests">/);
assert.match(discovery,/Array\.from\(\{length:80\}/,
 'guest choices remain in dormant code for reviewed reopening');
assert.match(discovery,/function discoverySearchFromUi\(event\)/);

assert.match(build,/function compactReleasedCustomerComments\(/);
assert.match(build,/function compactReleasedMerchantComments\(/);
assert.match(build,/validateClassicScriptSyntax\(released,'emitted customer.js'\)/);
assert.match(build,/validateClassicScriptSyntax\(released,'emitted merchant.js'\)/);
assert.match(read('.github/workflows/audit.yml'),/tests\/marked-inputs-v1-908\.mjs/);
console.log('V1.908 PASS — Admin coupon quick values, merchant stock, customer care and discovery choices preserve explicit actions.');
