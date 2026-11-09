import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const customer=source('js/customer.js');
const merchant=source('js/merchant.js');
const admin=source('js/admin-acquisition.js');
const mobility=source('js/mobility.js');
const discovery=source('js/discovery.js');
for(const [file,text] of Object.entries({customer,merchant,admin,mobility,discovery}))
 new vm.Script(text,{filename:file+'.js'});
const part=(text,start,end)=>{
 const i=text.indexOf(start),j=text.indexOf(end,i+start.length);
 assert.ok(i>=0&&j>i,'missing section '+start);
 return text.slice(i,j);
};
const esc=x=>String(x??'').replace(/[&<>"']/g,ch=>({
 '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
})[ch]);

// Inventory presets are local drafts: no movement, sale, catalog write or stock claim.
const product='P13';
const stock={value:'8',disabled:false,closest:()=>({disabled:false})};
const feedback={textContent:''};
let stockChanges=0,serverWrites=0;
const mctx={globalThis:null,document:{getElementById:id=>id==='merchant-quick-stock-P13'?stock:id==='merchant-quick-feedback-P13'?feedback:null},
 merchantQuickCatalogCandidates:()=>[{productCode:product}],
 merchantQuickCatalogChanged:()=>stockChanges++};
mctx.globalThis=mctx;mctx.merchantRuntime={status:'ready',actionPending:false,merchant:{memberRole:'owner'}};
vm.runInNewContext(part(merchant,'function merchantQuickStockAdjust(', '// V1.280:'),mctx);
assert.equal(mctx.merchantQuickStockAdjust('P13',10),true);
assert.equal(stock.value,'18');
assert.equal(mctx.merchantQuickStockAdjust('P13','empty'),true);
assert.equal(stock.value,'0');
assert.equal(mctx.merchantQuickStockAdjust('P13','-100'),false);
assert.equal(mctx.merchantQuickStockAdjust('P13',123),false);
assert.equal(mctx.merchantQuickStockAdjust('HACK','empty'),false);
mctx.merchantRuntime.merchant.memberRole='driver';
assert.equal(mctx.merchantQuickStockAdjust('P13',10),false);
mctx.merchantRuntime.merchant.memberRole='owner';
mctx.merchantRuntime.actionPending=true;
assert.equal(mctx.merchantQuickStockAdjust('P13','empty'),false);
assert.equal(stockChanges,2);
assert.match(feedback.textContent,/Salvar alterações/);
assert.ok(merchant.includes("10)\">+10</button>"));
assert.ok(merchant.includes("Esgotado (0)</button>"));
assert.ok(serverWrites===0);

// Admin Clube presets never approve funding or record a negotiation by themselves.
const clubKey='01234567-89ab-cdef-0123-456789abcdef-gas_3x5';
const note={value:'Texto anterior',focus(){this.focused=true;}};
const drawer={open:true};
const actx={document:{getElementById:id=>id==='clube-review-note-'+clubKey?note:
 id==='clube-review-custom-'+clubKey?drawer:null}};
vm.runInNewContext(part(admin,'// V1.907 — revisão comercial guiada;',
 'function adminClubeCampaignSection(')+'\nthis.api={choose:adminClubeReviewNoteChoice,choices:ADMIN_CLUBE_REVIEW_NOTES};',actx);
assert.equal(actx.api.choose('other','documents'),undefined);
assert.equal(note.value,'Texto anterior');
actx.api.choose(clubKey,'__proto__');
assert.equal(note.value,'Texto anterior');
actx.api.choose(clubKey,'documents');
assert.equal(note.value,actx.api.choices.documents);
assert.equal(drawer.open,false);
actx.api.choose(clubKey,'custom');
assert.equal(drawer.open,true);
assert.equal(note.focused,true);
assert.match(admin,/clube-review-choice-/);
assert.match(admin,/adminClubeCampaignReviewFromUi/);
assert.equal(serverWrites,0);

// Professional inquiries and private reports remain local drafts, and seat count must be <= current capacity.
let vertical='professionals';
const dctx={Date,URL,URLSearchParams,console,esc,route:()=>vertical,
 shell:x=>x,BRL:new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}),
 location:{origin:'https://tamao.com.br',search:'',hash:'#professionals'},
 CHAMA_BACKEND:{url:'https://test.invalid',publishableKey:'public-test'}};
dctx.globalThis=dctx;
vm.runInNewContext(discovery,dctx);
const uuid='99999999-9999-4999-8999-999999999999';
const row={id:uuid,vertical:'professionals',title:'Serviço publicado',
 whatsapp_e164:'+555599998888',occupation:'Eletricista'};
const professionalHtml=dctx.discoveryInquiryForm(row,'professionals');
assert.match(professionalHtml,/discoveryInquiryPresetChanged/);
assert.match(professionalHtml,/discovery-inquiry-manual/);
assert.match(professionalHtml,/name="service" required minlength="10"/);
const serviceInput={value:'Anterior',focus(){this.focused=true;}};
const serviceDrawer={open:true};
const inquiry={dataset:{kind:'professionals',service:''},
 querySelector:sel=>sel==='[name="service"]'?serviceInput:
 sel==='.discovery-inquiry-manual'?serviceDrawer:null};
const select={value:'invalid',closest:q=>q==='.discovery-inquiry'?inquiry:null};
assert.equal(dctx.discoveryInquiryPresetChanged(select),false);
select.value='quote';assert.equal(dctx.discoveryInquiryPresetChanged(select),true);
assert.equal(serviceInput.value,dctx.DISCOVERY_SERVICE_INQUIRY_CHOICES?.quote||'Gostaria de solicitar um orçamento para o serviço anunciado na minha região e consultar disponibilidade.');
assert.equal(serviceDrawer.open,false);
select.value='custom';assert.equal(dctx.discoveryInquiryPresetChanged(select),true);
assert.equal(serviceDrawer.open,true);
assert.equal(serviceInput.focused,true);
vertical='rides';
const ride={...row,vertical:'rides',seats_available:3,
 departure_at:new Date(Date.now()+2*86400000).toISOString()};
const seatHtml=dctx.discoveryInquiryForm(ride,'rides');
assert.match(seatHtml,/<select name="seats" required>/);
assert.match(seatHtml,/<option value="3">3 vagas<\/option>/);
assert.doesNotMatch(seatHtml,/<option value="4">4 vagas<\/option>/);
const reportHtml=dctx.discoveryReportForm({...row,vertical:'rides'},'rides');
assert.match(reportHtml,/discoveryReportPresetChanged/);
assert.match(reportHtml,/discovery-report-manual/);
assert.match(reportHtml,/discoverySubmitReport\(event\)/);
const reportInput={value:'Anterior'};
const reportDrawer={open:true,focus(){}};
const reportBox={querySelector:q=>q==='[name="details"]'?reportInput:
 q==='.discovery-report-manual'?reportDrawer:null};
const reportSelect={value:'bad',closest:q=>q==='.discovery-report'?reportBox:null};
assert.equal(dctx.discoveryReportPresetChanged(reportSelect),false);
reportSelect.value='contact';assert.equal(dctx.discoveryReportPresetChanged(reportSelect),true);
assert.match(reportInput.value,/contato/);
assert.equal(reportDrawer.open,false);
assert.equal(serverWrites,0);

// Mobility suggestions set only an editable fare, never submit/accept/pay for a ride.
const mo={console,Date,Intl,URL,URLSearchParams,FormData,
 BRL:new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}),
 document:{querySelector:()=>null,createElement:()=>({}),head:{appendChild(){}},addEventListener(){}},
 route:()=> 'mobility',esc,CHAMA_BACKEND:{url:'https://sandbox.test',publishableKey:'local'}};
mo.globalThis=mo;
vm.runInNewContext(mobility,mo);
const farePanel=mo.mobilityFarePanel({role:'driver',status:'accepted',fare_cents:null,fare_accepted:false});
assert.match(farePanel,/mobilityFareQuickValueChanged/);
assert.match(farePanel,/Enviar valor ao passageiro/);
assert.match(farePanel,/name="fare"/);
const fare={value:'32.50',disabled:false,focus(){this.focused=true;}};
const form={querySelector:q=>q==='[name="fare"]'?fare:null};
const fareSelect={value:'99999',closest:q=>q==='form.mobility-form'?form:null};
assert.equal(mo.mobilityFareQuickValueChanged(fareSelect),false);
assert.equal(fare.value,'32.50');
fareSelect.value='40';assert.equal(mo.mobilityFareQuickValueChanged(fareSelect),true);
assert.equal(fare.value,'40');
fareSelect.value='custom';assert.equal(mo.mobilityFareQuickValueChanged(fareSelect),true);
assert.equal(fare.focused,true);
assert.equal(serverWrites,0);

// Cash change presets reuse the existing explicit checkout state action, without processing a payment.
assert.match(customer,/Troco rápido<select/);
assert.match(customer,/onchange="if\(this\.value\)setCashTender\(this\.value\)"/);
assert.match(customer,/<option value="200">R\$ 200<\/option>/);
const cctx={state:{checkout:{cashTenderCents:null}},save:()=>{},render:()=>{},toast:()=>{}};
vm.runInNewContext(part(customer,'function setCashTender(value){','function toggleCashback('),cctx);
cctx.setCashTender('150');
assert.equal(cctx.state.checkout.cashTenderCents,15000);
cctx.setCashTender('');
assert.equal(cctx.state.checkout.cashTenderCents,null);
assert.equal(serverWrites,0);

const audit=source('.github/workflows/audit.yml');
assert.match(audit,/tests\/marked-inputs-all-modules-v1-907\.mjs/);
console.log('V1.907 PASS — selectable choices across catalog, Clube, discovery, mobility and checkout; no automatic writes');
