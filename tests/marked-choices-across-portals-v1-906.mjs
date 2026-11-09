import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const merchant=read('js/merchant.js');
const customer=read('js/customer.js');
const admin=read('js/admin-activations.js');
for(const [name,source] of [['merchant',merchant],['customer',customer],['admin',admin]])
  new vm.Script(source,{filename:name+'.js'});
const section=(source,start,end)=>{
  const a=source.indexOf(start),b=source.indexOf(end,a+start.length);
  assert.ok(a>=0&&b>a,'missing region '+start);
  return source.slice(a,b);
};
const esc=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;')
  .replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const fields=new Map();
const get=id=>fields.get(id)||null;
let merchantWrites=0,customerWrites=0,adminWrites=0;
const merchantContext=vm.createContext({
  document:{getElementById:get},esc,merchantRuntime:{adsCampaign:null},
  merchantInvoke:()=>{merchantWrites++;throw Error('No backend should be called');}
});
vm.runInContext(
  section(merchant,'// V1.906 — propostas','// TAMÃO Ads V1.233')+
  section(merchant,'function merchantAdsCampaignSection','async function merchantAdsCampaignAct')+
  section(merchant,'// Presets fill existing fields','async function merchantLiveSaveLogistics()')+
  'this.api={preset:merchantAdsCampaignPresetChanged,show:merchantAdsCampaignSection,logistics:merchantSettingQuickChoice,copy:MERCHANT_ADS_COPY_PRESETS};',
  merchantContext);
const m=merchantContext.api;
const page=m.show({merchantId:'m-1',memberRole:'owner'});
assert.match(page,/ads-campaign-preset/);
assert.match(page,/ads-campaign-custom-text/);
assert.match(page,/ads-campaign-category/);
assert.match(page,/merchantAdsCampaignAct\(\\'save\\'\)/);
assert.doesNotMatch(page,/<details id="ads-campaign-custom-text" open/);
fields.set('ads-campaign-title',{value:'old'});
fields.set('ads-campaign-description',{value:'old'});
fields.set('ads-campaign-custom-text',{open:true});
m.preset('__proto__');
assert.equal(get('ads-campaign-title').value,'old');
m.preset('products');
assert.equal(get('ads-campaign-title').value,m.copy.products.title);
assert.equal(get('ads-campaign-description').value,m.copy.products.description);
assert.ok(get('ads-campaign-description').value.length>=30);
assert.equal(get('ads-campaign-custom-text').open,false);
assert.equal(merchantWrites,0);
const fee={value:'2.00'},eta={value:'30'},capacity={value:'3'};
fields.set('live-delivery-fee',fee);
fields.set('live-eta',eta);
fields.set('live-capacity',capacity);
m.logistics({value:'15'},'live-delivery-fee');
m.logistics({value:'45'},'live-eta');
m.logistics({value:'10'},'live-capacity');
assert.deepEqual([fee.value,eta.value,capacity.value],['15','45','10']);
m.logistics({value:'999'},'live-delivery-fee');
m.logistics({value:'10'},'live-payment-pix');
assert.equal(fee.value,'15');
assert.match(merchant,/merchantLiveSaveLogistics\(\)/);
assert.match(merchant,/merchantLiveSaveCapacity\(\)/);

let deliveryChanges=0;
const customerContext=vm.createContext({
  document:{getElementById:get},deliveryDetailsChanged:()=>{deliveryChanges++;customerWrites++;}
});
vm.runInContext(
  section(customer,'// V1.906 — optional delivery notes','function syncDeliveryDetailsFromUi(')+
  'this.api={choose:customerDeliveryNotePresetChanged,notes:CUSTOMER_DELIVERY_NOTE_PRESETS};',
  customerContext);
const notes={value:'Outro recado antigo',focus(){this.focused=true;}};
const custom={open:true};
fields.set('delivery-notes',notes);
fields.set('delivery-notes-custom',custom);
customerContext.api.choose('__proto__');
assert.equal(notes.value,'Outro recado antigo');
assert.equal(deliveryChanges,0);
customerContext.api.choose('gate');
assert.equal(notes.value,'Por favor, chame no portão ao chegar.');
assert.equal(custom.open,false);
assert.equal(deliveryChanges,1);
customerContext.api.choose('custom');
assert.equal(custom.open,true);
assert.equal(notes.focused,true);
assert.equal(deliveryChanges,1,'manual edit does not silently save');
customerContext.api.choose('');
assert.equal(notes.value,'');
assert.equal(deliveryChanges,2);
assert.match(customer,/id="delivery-note-choice"/);
assert.match(customer,/customDeliveryNote\?'open':''/);
assert.match(customer,/syncDeliveryDetailsFromUi/);
assert.ok(!customer.includes('onchange="customerDeliveryNotePresetChanged(this.value)" disabled'));

const adminContext=vm.createContext({
  document:{getElementById:get},esc,adminCurrentRole:()=> 'superadmin',
  adminRoleCanSection:()=>true,
  adminRuntime:{session:{user:{id:'owner-1'}}},
  adminActivationDesk:{
    actor:'owner-1',role:'superadmin',checkedAt:new Date().toISOString(),
    data:{adsSalesPlans:{approvedCreatives:1,totalPlans:0,rows:[{
      merchantId:'01234567-89ab-cdef-0123-456789abcdef',companyName:'Revenda Teste',
      title:'Criativo existente',creativeEligible:true,creativeVersion:1,
      planCreativeVersion:1,version:0,stage:'draft',note:'',
      priceCents:9900,durationDays:7
    }]},adsOffers:null}
  },
  adminPerform:()=>{adminWrites++;throw Error('Should not write');}
});
vm.runInContext(
  section(admin,'// V1.906 — internal commercial planning','// TAMÃO V1.309')+
  section(admin,'function adminAdsSalesPlansView()','async function adminAdsSalesPlanSave(')+
  'this.api={choose:adminAdsPlanQuickChoose,view:adminAdsSalesPlansView,notes:ADMIN_ADS_PLAN_NOTE_PRESETS};',
  adminContext);
const a=adminContext.api,id='ads-plan-01234567-89ab-cdef-0123-456789abcdef';
const rendered=a.view();
assert.match(rendered,/price-choice/);
assert.match(rendered,/days-choice/);
assert.match(rendered,/note-choice/);
assert.match(rendered,/Informar valor específico/);
assert.match(rendered,/Salvar planejamento/);
for(const [suffix,initial] of [['price','99'],['days','7'],['note',a.notes.approach]]){
  fields.set(id+'-'+suffix,{value:initial,dataset:{initial}});
  fields.set(id+'-'+suffix+'-manual',{open:false});
}
a.choose('01234567-89ab-cdef-0123-456789abcdef','price','399');
a.choose('01234567-89ab-cdef-0123-456789abcdef','days','30');
a.choose('01234567-89ab-cdef-0123-456789abcdef','note','documents');
assert.equal(get(id+'-price').value,'399');
assert.equal(get(id+'-days').value,'30');
assert.equal(get(id+'-note').value,a.notes.documents);
a.choose('01234567-89ab-cdef-0123-456789abcdef','price','999999');
assert.equal(get(id+'-price').value,'399','unknown presets cannot set arbitrary amounts');
a.choose('not-uuid','note','review');
assert.equal(get(id+'-note').value,a.notes.documents);
a.choose('01234567-89ab-cdef-0123-456789abcdef','price','keep');
assert.equal(get(id+'-price').value,'99');
a.choose('01234567-89ab-cdef-0123-456789abcdef','note','custom');
assert.equal(get(id+'-note-manual').open,true);
assert.equal(adminWrites,0);

console.log('V1.906 PASS — marked inputs in customer, merchant and Admin; no server writes or financial side effects');
