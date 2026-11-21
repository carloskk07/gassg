import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const growth=read('js/growth.js');
const lazy=read('js/merchant-public-plans.js');
const css=read('css/merchant-landing-executive.css');
const sw=read('sw.js');

new vm.Script(growth,{filename:'js/growth.js'});
const helperStart=lazy.indexOf('function merchantPlanTicketPreview(value){');
const helperEnd=lazy.indexOf('\nglobalThis.merchantPlanTicketPreview=merchantPlanTicketPreview;',helperStart);
assert.ok(helperStart>0&&helperEnd>helperStart,'Quick comparison helper must be isolated and readable');

const money=value=>'R$ '+Number(value).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
const tickets=[100,120,200].map(value=>({
 value,
 attrs:{'aria-pressed':String(value===120)},
 getAttribute(name){return name==='data-merchant-ticket'?String(this.value):this.attrs[name]},
 setAttribute(name,value){this.attrs[name]=String(value)}
}));
const reference=[{textContent:''},{textContent:''},{textContent:''},{textContent:''},{textContent:''}];
const savings=[100,150,200,250].map(bps=>({
 bps,textContent:'',
 getAttribute(name){return name==='data-merchant-saving-bps'?String(this.bps):null}
}));
const section={querySelectorAll(selector){
 if(selector==='[data-merchant-ticket]')return tickets;
 if(selector==='[data-merchant-order-ticket]')return reference;
 if(selector==='[data-merchant-saving-bps]')return savings;
 throw new Error('Unknown query '+selector);
}};
const context={
 document:{getElementById:id=>id==='merchant-plans'?section:null},
 BRL:{format:money}
};
vm.runInNewContext(lazy.slice(helperStart,helperEnd)+';this.preview=merchantPlanTicketPreview;',context);
assert.equal(context.preview(200),true);
assert.deepEqual(tickets.map(b=>b.attrs['aria-pressed']),['false','false','true']);
assert.ok(reference.every(item=>item.textContent==='R$ 200,00'));
assert.deepEqual(savings.map(x=>x.textContent),['R$ 2,00','R$ 3,00','R$ 4,00','R$ 5,00']);
assert.equal(context.preview(100),true);
assert.deepEqual(tickets.map(b=>b.attrs['aria-pressed']),['true','false','false']);
assert.deepEqual(savings.map(x=>x.textContent),['R$ 1,00','R$ 1,50','R$ 2,00','R$ 2,50']);
assert.equal(context.preview(99),false,'Invalid or unlisted ticket must not change the visible rates');
assert.equal(context.preview('abc'),false);
assert.equal(context.preview(120),true);
assert.deepEqual(savings.map(x=>x.textContent),['R$ 1,20','R$ 1,80','R$ 2,40','R$ 3,00']);
assert.deepEqual(tickets.map(b=>b.attrs['aria-pressed']),['false','true','false']);

const start=growth.indexOf('function tamaoMerchantExecutiveStyles(){');
const end=growth.indexOf('\nfunction currentMerchantPilotInviteToken(){',start);
assert.ok(start>=0&&end>start);
const source=growth.slice(start,end);
const merchantPlans=[
 {key:'flex_daily',name:'Flex Diário',bps:900,cents:0},
 {key:'credit_01990',name:'Essencial',bps:800,cents:1990},
 {key:'credit_04990',name:'Popular',bps:750,cents:4990},
 {key:'credit_09990',name:'Profissional',bps:700,cents:9990},
 {key:'credit_19990',name:'Alto Volume',bps:650,cents:19990}
];
const render=plans=>vm.runInNewContext(source+';merchantsLanding()',{
 globalThis:{merchantPortalRequested:()=>false,CHAMA_INTERNAL_PILOT:false},
 MERCHANT_PUBLIC_BILLING_PLANS:plans,
 policyPercent:rate=>Number(rate*100).toLocaleString('pt-BR',{maximumFractionDigits:2})+'%',
 merchantMarginExample:()=>({gross:6000,chamaFee:540}),
 prelaunchMerchantLeadSection:()=>'<form id="partner-interest"></form>',
 BRL:{format:money},shell:html=>html
});
const html=render(merchantPlans);
assert.match(html,/merchant-landing-v1117/);

assert.doesNotMatch(html,/merchant-v1118-receipt|data-merchant-compare-plan=/,
 'The receipt must load only on merchant visit, not in customer initial JS');
assert.match(growth,/merchantPlanReceiptHydrate/);
assert.match(lazy,/function merchantPlanReceiptHydrate\(\)/);
assert.match(lazy,/function merchantPlanReceiptPreview\(key,ticketValue\)/);
assert.match(lazy,/grid.insertAdjacentElement\('afterend',receipt\)/);
assert.match(lazy,/setTimeout\(merchantPlanReceiptHydrate,0\)/);
assert.ok(css.includes('.merchant-v1118-receipt-numbers'));

assert.match(html,/merchant-v1117-ticketbar/);
assert.equal((html.match(/data-merchant-ticket="/g)||[]).length,3);
assert.match(html,/globalThis\.merchantPlanTicketPreview\?\.\(100\)/);
assert.match(growth,/merchant-public-plans\.js\?v=1119/);
assert.equal((html.match(/aria-pressed="true"/g)||[]).length,1);
assert.equal((html.match(/data-merchant-saving-bps="/g)||[]).length,4);
assert.match(html,/data-merchant-saving-bps="250">R\$ 3,00/);
assert.match(html,/merchant-v1115-plan-featured[\s\S]*?Alto Volume/);
assert.match(html,/MAIOR REDUÇÃO DE TAXA/);
assert.match(html,/FLEX DIÁRIO · SEM RECARGA/);
assert.match(html,/Crédito antecipado/);
assert.match(html,/Condições conferidas no catálogo oficial|Valores de referência\. Confira as taxas/);
assert.ok(html.includes('onclick="openMerchantPortal(true)"'),'All options must keep actual signup');
assert.doesNotMatch(html,/Pedidos garantidos|mensalidade obrigatória|Renda garantida/);

for(const cls of ['.merchant-landing-v1117','.merchant-v1117-ticketbar',
 '.merchant-v1117-ticketbar-controls button[aria-pressed="true"]',
 '.merchant-landing-v1117 .merchant-v1115-plan-featured',
 '.merchant-landing-v1117 .merchant-v1114-index']){
 assert.ok(css.includes(cls),'Missing premium design token '+cls);
}
assert.ok(css.includes('prefers-reduced-motion:reduce'));
assert.ok(css.includes('@media(max-width:520px)'));
assert.ok(css.includes(':focus-visible'));
assert.match(sw,/CACHE='tamao-sg-v1\.1119'/);

const startReceipt=lazy.indexOf('function merchantPlanReceiptPreview(key,ticketValue){');
const endReceipt=lazy.indexOf('globalThis.merchantPlanReceiptPreview=merchantPlanReceiptPreview;',startReceipt);
assert.ok(startReceipt>0&&endReceipt>startReceipt,'Receipt helper must stay in lazy module');
const makeChoice=(key,bps,credit,name)=>{
 const attrs={'data-merchant-compare-plan':key,'data-merchant-plan-bps':String(bps),
  'data-merchant-plan-credit-cents':String(credit),'data-merchant-plan-name':name,
  'aria-pressed':String(key==='credit_01990')};
 return {getAttribute:k=>attrs[k],setAttribute:(k,v)=>{attrs[k]=String(v)}};
};
const choices=[makeChoice('credit_01990',800,1990,'Essencial'),makeChoice('credit_04990',750,4990,'Popular')];
const receiptOutputs=Object.fromEntries(['plan','flex','fee','saving','credit','balance','status'].map(k=>[k,{textContent:''}]));
const receiptTicket=[{getAttribute:k=>k==='aria-pressed'?'true':k==='data-merchant-ticket'?'120':null}];
const receiptSection={
 getAttribute:k=>k==='data-merchant-flex-bps'?'900':null,
 querySelectorAll:s=>{
  if(s==='[data-merchant-compare-plan]')return choices;
  if(s==='[data-merchant-ticket]')return receiptTicket;
  const match=/^\[data-merchant-receipt-([a-z]+)\]$/.exec(s);
  if(match&&receiptOutputs[match[1]])return [receiptOutputs[match[1]]];
  throw new Error('Unexpected receipt selector '+s);
 }
};
const receiptContext={BRL:{format:money},document:{getElementById:k=>
 k==='merchant-plans'?receiptSection:k==='merchant-plan-receipt'?{}:null}};
vm.runInNewContext(lazy.slice(startReceipt,endReceipt)+';this.receiptPreview=merchantPlanReceiptPreview;',receiptContext);
assert.equal(receiptContext.receiptPreview('credit_01990',200),true);
assert.equal(receiptOutputs.flex.textContent,'R$ 18,00');
assert.equal(receiptOutputs.fee.textContent,'R$ 16,00');
assert.equal(receiptOutputs.saving.textContent,'R$ 2,00');
assert.equal(receiptOutputs.balance.textContent,'R$ 3,90');
assert.equal(receiptContext.receiptPreview('credit_04990',120),true);
assert.equal(receiptOutputs.fee.textContent,'R$ 9,00');
assert.equal(receiptOutputs.balance.textContent,'R$ 40,90');
assert.equal(choices[1].getAttribute('aria-pressed'),'true');
assert.equal(receiptContext.receiptPreview('invalid',120),false);
choices[1].setAttribute('data-merchant-plan-credit-cents','100');
assert.equal(receiptContext.receiptPreview('credit_04990',200),true);
assert.equal(receiptOutputs.balance.textContent,'Saldo insuficiente');
assert.match(receiptOutputs.status.textContent,/Saldo insuficiente/);
assert.doesNotMatch(lazy.slice(startReceipt,endReceipt),/fetch\(|\.rpc\(|merchant-billing-pix/);


assert.match(lazy,/function merchantPlanCoverageCount\(ticket,bps,cents\)/);
assert.match(lazy,/function merchantPlanCoverageRefresh\(ticket\)/);
assert.match(lazy,/merchant-v1119-ways-grid/);
assert.match(lazy,/data-merchant-way-signup/);
assert.match(lazy,/data-merchant-receipt-coverage/);
assert.match(growth,/merchant-v1119-conversion-actions/);
for(const cls of ['.merchant-v1119-coverage','.merchant-v1119-ways-grid',
 '.merchant-v1119-receipt-coverage','.merchant-v1119-conversion-actions'])
 assert.ok(css.includes(cls),'Missing premium V1.1119 UI '+cls);
const coverageStart=lazy.indexOf('function merchantPlanCoverageCount(ticket,bps,cents){');
const coverageEnd=lazy.indexOf('function merchantPlanCoverageRefresh(ticket){',coverageStart);
assert.ok(coverageStart>0&&coverageEnd>coverageStart);
const coverageContext={};
vm.runInNewContext(lazy.slice(coverageStart,coverageEnd)+';this.count=merchantPlanCoverageCount;',coverageContext);
assert.equal(coverageContext.count(120,800,1990),2);
assert.equal(coverageContext.count(200,800,1990),1);
assert.equal(coverageContext.count(100,650,19990),30);
assert.equal(coverageContext.count(120,700,9990),11);
assert.equal(coverageContext.count(120,0,1990),null);
assert.equal(coverageContext.count(120,800,-1),null);
assert.equal(coverageContext.count(99,800,1990),null);
assert.doesNotMatch(lazy.slice(coverageStart,coverageEnd),/fetch\(|\.rpc\(|billing-pix/);

console.log('V1.1117 PASS: premium art direction, live billing plan integrity, accessible one-tap savings and real signup.');
