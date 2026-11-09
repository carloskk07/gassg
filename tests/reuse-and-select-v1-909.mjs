import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const admin=read('js/admin.js'),merchant=read('js/merchant.js'),discovery=read('js/discovery.js');
for(const [name,source] of Object.entries({admin,merchant,discovery}))
  new vm.Script(source,{filename:name+'.js'});
const section=(source,first,last)=>{
 const a=source.indexOf(first),b=source.indexOf(last,a+first.length);
 assert.ok(a>=0&&b>a,'missing tested region: '+first);
 return source.slice(a,b);
};

const uuid='12345678-1234-4234-8234-123456789abc';
const fields=new Map();
let remoteCalls=0;
const actx=vm.createContext({
 document:{getElementById:id=>fields.get(id)||null},
 adminPerform:()=>{remoteCalls++;throw Error('No server action in preset');}
});
vm.runInContext(
 section(admin,'// V1.909 — selected shortcuts reuse ONLY','async function adminConvertPilotPartner(id){')+
 section(admin,'// V1.909 — purely hypothetical discount;','function adminMerchantTrialView(detail){')+
 'this.api={quick:adminPilotQuickValue,reuse:adminPilotReuseField,discount:adminMerchantTrialDiscountChoose};',
 actx);
const a=actx.api;
for(const field of ['stock','fee','eta','phone','whatsapp','responsible','owner-name']){
 fields.set('pilot-'+uuid+'-'+field,{value:'',disabled:false});
}
fields.get('pilot-'+uuid+'-phone').value='55 55 99999-1111';
fields.get('pilot-'+uuid+'-responsible').value='  Responsável real  ';
assert.equal(a.reuse(uuid,'phone','whatsapp'),true);
assert.equal(fields.get('pilot-'+uuid+'-whatsapp').value,'55 55 99999-1111');
assert.equal(a.reuse(uuid,'responsible','owner-name'),true);
assert.equal(fields.get('pilot-'+uuid+'-owner-name').value,'Responsável real');
assert.equal(a.reuse(uuid,'responsible','whatsapp'),false);
assert.equal(a.reuse('fake','phone','whatsapp'),false);
fields.get('pilot-'+uuid+'-phone').value='  ';
assert.equal(a.reuse(uuid,'phone','whatsapp'),false);
assert.equal(fields.get('pilot-'+uuid+'-whatsapp').value,'55 55 99999-1111');
assert.equal(a.quick(uuid,'stock','50'),true);
assert.equal(fields.get('pilot-'+uuid+'-stock').value,'50');
assert.equal(a.quick(uuid,'fee','10'),true);
assert.equal(a.quick(uuid,'eta','45'),true);
assert.equal(fields.get('pilot-'+uuid+'-fee').value,'10');
assert.equal(fields.get('pilot-'+uuid+'-eta').value,'45');
assert.equal(a.quick(uuid,'stock','100000'),false);
assert.equal(a.quick(uuid,'fee','-1'),false);
assert.equal(a.quick(uuid,'state','RS'),false);
assert.equal(a.quick('bad-id','stock','5'),false);
const locked=fields.get('pilot-'+uuid+'-stock');
locked.disabled=true;
assert.equal(a.quick(uuid,'stock','5'),false);
assert.equal(locked.value,'50');
fields.set('admin-merchant-trial-benefit',{value:'0,00',disabled:false});
assert.equal(a.discount('15'),true);
assert.equal(fields.get('admin-merchant-trial-benefit').value,'15,00');
assert.equal(a.discount('100'),false);
assert.equal(a.discount('__proto__'),false);
assert.equal(remoteCalls,0,'UI presets must not call backend');
assert.match(admin,/Usar nome do responsável/);
assert.match(admin,/Mesmo telefone informado/);
assert.match(admin,/adminPilotQuickValue\(/);
assert.match(admin,/id="admin-merchant-trial-qty"/);
assert.match(admin,/Array.from\(\{length:20\}/);
assert.match(admin,/adminMerchantTrialEstimate\(/);
assert.match(admin,/assisted-merchant-onboarding/);
assert.match(admin,/PENDENTE\?/);

const stock={value:'12'};
const note={textContent:''};
let toastCount=0;
const mctx=vm.createContext({
 document:{getElementById:id=>id==='live-stock-P13'?stock:id==='merchant-catalog-pending-P13'?note:null},
 toast:()=>toastCount++,remoteWrite:()=>{remoteCalls++;throw Error('Should not write');}
});
vm.runInContext(section(merchant,'function merchantCatalogAdjustStock(code,delta){','function merchantCatalogMarkEdited(code){')+
 'this.quick=merchantCatalogAdjustStock;',mctx);
assert.equal(mctx.quick('P13',5),true);
assert.equal(stock.value,'17');
assert.equal(mctx.quick('P13',10),true);
assert.equal(stock.value,'27');
assert.equal(mctx.quick('P13','empty'),true);
assert.equal(stock.value,'0');
assert.match(note.textContent,/não salva/);
assert.equal(mctx.quick('P13','bad'),false);
assert.equal(mctx.quick('P13',-500),false);
assert.equal(mctx.quick('bad id','empty'),false);
stock.value='100000';
assert.equal(mctx.quick('P13',5),false,'upper bound respected');
stock.value='oops';
assert.equal(mctx.quick('P13','empty'),false,'invalid previous stock not hidden');
assert.ok(toastCount>0);
assert.equal(remoteCalls,0);
assert.match(merchant,/Adicionar cinco unidades de/);
assert.match(merchant,/Adicionar dez unidades de/);
assert.match(merchant,/Marcar .* como esgotado/);
assert.match(merchant,/merchantLiveSaveProduct/);

const dctx={Date,URL,URLSearchParams,console,
 esc:s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;')
   .replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;'),
 CHAMA_BACKEND:{url:'https://sandbox.test',publishableKey:'test'},
 location:{origin:'https://tamao.com.br',search:'',hash:'#stays'}};
dctx.globalThis=dctx;
vm.runInNewContext(discovery,dctx);
const item={id:uuid,title:'Hospedagem',whatsapp_e164:'+5555999991111',guests:3,vertical:'stays'};
const html=dctx.discoveryInquiryForm(item,'stays');
assert.match(html,/<select name="guests" required>/);
for(const value of ['1','2','3'])assert.ok(html.includes('<option value="'+value+'">'+value+'</option>'));
assert.ok(!html.includes('<option value="4">'));
assert.match(html,/name="checkin" type="date" required/);
assert.match(html,/name="checkout" type="date" required/);
assert.match(html,/discoveryPrepareInquiry\(this\)/);
assert.equal(dctx.discoveryInquiryForm({...item,guests:81},'stays'),'');
assert.equal(dctx.discoveryInquiryForm({...item,guests:0},'stays'),'');
assert.equal(dctx.discoveryInquiryForm({...item,whatsapp_e164:'invalid'},'stays'),'');
assert.match(read('.github/workflows/audit.yml'),/tests\/reuse-and-select-v1-909\.mjs/);

console.log('V1.909 PASS: admin assisted onboarding, hypothetical trial, merchant stock, and capped stays; no writes on select.');
