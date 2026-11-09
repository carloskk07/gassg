import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const admin=read('js/admin-activations.js');
const mobility=read('js/mobility.js');
const discovery=read('js/discovery.js');
for(const [name,source] of Object.entries({admin,mobility,discovery}))
 new vm.Script(source,{filename:name+'.js'});
const span=(source,start,end)=>{
 const a=source.indexOf(start),b=source.indexOf(end,a+start.length);
 assert.ok(a>=0&&b>a,'Missing code boundary: '+start);
 return source.slice(a,b);
};
const id='12345678-1234-4234-8234-123456789abc';
const fields=new Map();
let confirmations=0,allowOverride=false,writes=0;
const ctx=vm.createContext({
 document:{getElementById:key=>fields.get(key)||null},
 confirm:()=>{confirmations++;return allowOverride;},
 adminPerform:()=>{writes++;throw Error('No automatic admin action');}
});
vm.runInContext(
 span(admin,'// V1.912 — notes are drafts','// V1.324 — verified authorization')+
 span(admin,'// V1.912 — only prepares an editable note','// V1.326 — manual return planning')+
 'this.chooseContact=adminAdsContactFillNote;this.chooseReturn=adminAdsReturnFillNote;',ctx);
const contactOutcome={value:''},contactNote={value:'',disabled:false};
fields.set('ads-contact-'+id+'-outcome',contactOutcome);
fields.set('ads-contact-'+id+'-note',contactNote);
assert.equal(ctx.chooseContact(id),false,'No guessed contact outcome');
assert.equal(ctx.chooseContact('invalid'),false);
contactOutcome.value='not_reached';
assert.equal(ctx.chooseContact(id),true);
assert.match(contactNote.value,/sem conseguir falar/);
contactOutcome.value='followup_requested';
const original=contactNote.value;
assert.equal(ctx.chooseContact(id),false,'No silent overwriting');
assert.equal(contactNote.value,original);
allowOverride=true;
assert.equal(ctx.chooseContact(id),true);
assert.match(contactNote.value,/solicitou um novo contato/);
contactOutcome.value='__proto__';
assert.equal(ctx.chooseContact(id),false);
contactNote.disabled=true;
contactOutcome.value='conversation';
assert.equal(ctx.chooseContact(id),false);
contactNote.disabled=false;
const returnNote={value:'',disabled:false};
fields.set('ads-return-'+id+'-note',returnNote);
assert.equal(ctx.chooseReturn(id,'schedule'),true);
assert.match(returnNote.value,/sem mensagem enviada automaticamente/);
allowOverride=false;
assert.equal(ctx.chooseReturn(id,'review'),false);
allowOverride=true;
assert.equal(ctx.chooseReturn(id,'review'),true);
assert.match(returnNote.value,/Solicitação da revenda recebida/);
assert.equal(ctx.chooseReturn(id,'__proto__'),false);
assert.equal(ctx.chooseReturn('invalid','schedule'),false);
assert.equal(writes,0);
assert.match(admin,/Usar descrição do resultado escolhido/);
assert.match(admin,/<option value="">Escolha o resultado que ocorreu<\/option>/);
assert.match(admin,/adminAdsContactRecord/);
assert.match(admin,/adminAdsReturnFillNote/);
assert.match(admin,/adminAdsFeedbackReturnAction/);
assert.match(admin,/if\(!confirm\('Registrar que você realizou esta tentativa de contato MANUAL/);

const mctx=vm.createContext({confirm:()=>allowOverride});
vm.runInContext(
 span(mobility,'// V1.912 — optional approximate points','const mobilityStates=')+
 'this.routeChoose=mobilityRouteQuickChoice;this.routeHtml=mobilityRouteQuickChoices;',mctx);
const inputs={origin:{value:'',disabled:false},destination:{value:'',disabled:false}};
let focusCount=0;
for(const input of Object.values(inputs))input.focus=()=>{focusCount++;};
const form={querySelector:query=>{
 const match=/^\[name="(origin|destination)"\]$/.exec(query);
 return match?inputs[match[1]]:null;
}};
const selector={value:'center',closest:pattern=>pattern==='form.mobility-form'?form:null};
assert.equal(mctx.routeChoose(selector,'origin'),true);
assert.equal(inputs.origin.value,'Centro');
assert.equal(inputs.destination.value,'');
selector.value='station';
allowOverride=false;
assert.equal(mctx.routeChoose(selector,'origin'),false);
assert.equal(inputs.origin.value,'Centro');
allowOverride=true;
assert.equal(mctx.routeChoose(selector,'destination'),true);
assert.equal(inputs.destination.value,'Rodoviária');
selector.value='custom';
assert.equal(mctx.routeChoose(selector,'origin'),true);
assert.equal(focusCount,1);
assert.equal(inputs.origin.value,'Centro');
selector.value='hack';
assert.equal(mctx.routeChoose(selector,'origin'),false);
assert.equal(mctx.routeChoose(selector,'email'),false);
assert.equal(mctx.routeChoose(null,'origin'),false);
inputs.origin.disabled=true;
selector.value='station';
assert.equal(mctx.routeChoose(selector,'origin'),false);
assert.match(mctx.routeHtml('origin'),/Escolher região aproximada de origem/);
assert.match(mctx.routeHtml('destination'),/Escolher região aproximada de destino/);
assert.match(mobility,/mobilityRouteQuickChoices\('origin'\)/);
assert.match(mobility,/mobilityRouteQuickChoices\('destination'\)/);
assert.match(mobility,/onsubmit="return mobilityCreate\(event\)"/);
assert.equal(writes,0);

class DateAt extends Date{
 constructor(...args){super(...(args.length?args:[2026,10,9,9,0,0]));}
}
const dInputs=new Map();
const dctx=vm.createContext({
 Date:DateAt,confirm:()=>allowOverride,
 document:{getElementById:k=>dInputs.get(k)||null},
 send:()=>{writes++;throw Error('No automatic contact')}
});
vm.runInContext(
 span(discovery,'// V1.912 — purely local draft shortcuts','// Optional inquiry details:')+
 'this.day=discoveryInquiryDayQuickChoice;this.dayHtml=discoveryInquiryDayChoices;this.price=discoveryQuickPriceCap;',dctx);
const preferred={value:'',disabled:false};
const inquiryBox={dataset:{kind:'professionals'},querySelector:q=>
 q==='input[name="preferred_day"]'?preferred:null};
const dateSelect={value:'1',closest:q=>q==='.discovery-inquiry'?inquiryBox:null};
assert.equal(dctx.day(dateSelect),true);
assert.equal(preferred.value,'2026-11-10');
allowOverride=false;
dateSelect.value='3';
assert.equal(dctx.day(dateSelect),false);
assert.equal(preferred.value,'2026-11-10');
allowOverride=true;
assert.equal(dctx.day(dateSelect),true);
assert.equal(preferred.value,'2026-11-12');
dateSelect.value='30';
assert.equal(dctx.day(dateSelect),false);
inquiryBox.dataset.kind='rides';dateSelect.value='1';
assert.equal(dctx.day(dateSelect),false,'Date shortcuts not for bookings');
assert.match(dctx.dayHtml(),/Amanhã/);
assert.equal((discovery.match(/discoveryInquiryDayChoices\(\)\+/g)||[]).length,2);
const filter={value:'',disabled:false};
dInputs.set('discovery-max-price',filter);
assert.equal(dctx.price({value:'300'}),true);
assert.equal(filter.value,'300');
assert.equal(dctx.price({value:'__proto__'}),false);
assert.equal(filter.value,'300');
assert.equal(dctx.price({value:''}),true);
assert.equal(filter.value,'');
filter.disabled=true;
assert.equal(dctx.price({value:'500'}),false);
assert.match(discovery,/id="discovery-max-price"/);
assert.match(discovery,/discoveryQuickPriceCap\(this\)/);
assert.match(discovery,/discoveryPrepareInquiry\(this\)/);
assert.match(discovery,/discoverySearchFromUi\(event\)/);
assert.equal(writes,0);
assert.match(read('.github/workflows/audit.yml'),/tests\/quick-choices-v1-912\.mjs/);
console.log('V1.912 PASS: Admin contact/return, mobility routes and discovery calendar/price quick choices are editable drafts without automatic actions.');
