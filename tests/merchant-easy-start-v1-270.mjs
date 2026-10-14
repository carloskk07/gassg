import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const src=read('js/merchant.js'),css=read('css/components.css');
const audit=read('.github/workflows/audit.yml');
const a=src.indexOf('function merchantProviderName(');
const b=src.indexOf('function merchantRevealControl(',a);
assert.ok(a>=0&&b>a);
const esc=x=>String(x).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const ctx=vm.createContext({esc,merchantTimestampFresh:()=>true});
vm.runInContext(src.slice(a,b),ctx);
const provider=(key,name)=>({
 provider:key,displayName:name,connectionMode:'oauth',
 connectReady:key==='mercadopago',setupState:'ready',adapterStatus:'implemented',
 verificationLevel:'provider',sortOrder:1,supportedMethods:['pix','card'],notes:'Receba diretamente.'
});
const mp=provider('mercadopago','Mercado Pago');
const stone=provider('stone','Stone');
const asaas=provider('asaas','<Asaas>');
const base={
 merchant:{memberRole:'owner',paymentMethods:{pix:true,card:false,cash:false}},
 paymentProviders:[mp,stone,asaas],
 paymentRoutes:[],
 receivingAccounts:[]
};
const initial=ctx.merchantPaymentConnectionsView(base);
assert.match(initial,/Escolher outro banco ou maquininha \(opcional\) • 3 opções/);
assert.match(initial,/Nenhum prestador adicional informado/);
assert.ok(!initial.includes('Prestadores que você já informou'));
assert.match(initial,/<details class="merchant-psp-optional/);
assert.match(initial,/Não pedimos senha nem chave de API/);
assert.match(initial,/&lt;Asaas&gt;/);
assert.doesNotMatch(initial,/<Asaas>/);
assert.doesNotMatch(initial,/<details class="merchant-psp-optional[^>]* open/);

const declared={...base,paymentRoutes:[{
 provider:'stone',active:true,verificationMode:'merchant_confirmed',
 metadata:{merchantDeclaredProvider:true}
}]};
const withDeclared=ctx.merchantPaymentConnectionsView(declared);
const divider=withDeclared.indexOf('<details class="merchant-psp-optional');
assert.ok(divider>0);
assert.match(withDeclared.slice(0,divider),/Stone/);
assert.doesNotMatch(withDeclared.slice(0,divider),/Mercado Pago/);
assert.match(withDeclared.slice(divider),/Mercado Pago/);
assert.match(withDeclared,/Prestadores que você já informou \(1\)/);
assert.match(withDeclared,/Escolher outro banco ou maquininha \(opcional\) • 2 opções/);

const active={...base,receivingAccounts:[{
 provider:'mercadopago',connected:true,
 capabilities:{directSalePaymentsEnabled:true,canValidateProviderTransactions:true,e2eValidated:false}
}]};
const h=ctx.merchantPaymentConnectionsView(active);
assert.match(h.slice(0,h.indexOf('<details class="merchant-psp-optional')),/AUTOMAÇÃO ATIVA/);
assert.doesNotMatch(h.slice(0,h.indexOf('<details class="merchant-psp-optional')),/INTEGRAÇÃO VERIFICADA/);

const empty={...base,merchant:{...base.merchant,acceptsCitywide:false},
 catalog:[]};
assert.match(ctx.merchantSetupView(empty),/Seu próximo passo: Produtos e preços/);
assert.match(ctx.merchantSetupView(empty),/Continuar configuração/);
const withProduct={...empty,catalog:[{
 active:true,availableStock:2,priceCents:4500,priceConfirmedAt:'2026-10-14'
}]};
assert.match(ctx.merchantSetupView(withProduct),/Seu próximo passo: Entregas/);
const withDelivery={...withProduct,merchant:{...withProduct.merchant,acceptsCitywide:true,deliveryFeeConfirmedAt:'2026-10-14'}};
assert.match(ctx.merchantSetupView(withDelivery),/Seu próximo passo: Recebimentos/);
const complete={...withDelivery,paymentRoutes:[{paymentMethod:'pix',active:true}]};
assert.doesNotMatch(ctx.merchantSetupView(complete),/Continuar configuração/);
assert.match(ctx.merchantSetupView(complete),/A habilitação para receber pedidos depende das verificações/);
assert.equal(ctx.merchantSetupView({...complete,merchant:{...complete.merchant,memberRole:'driver'}}),'');
assert.match(src,/Salvar como recebo/);
assert.match(src,/merchantManualPaymentRoute\('pix'\)/);
assert.match(src,/merchantManualPaymentRoute\('card'\)/);
assert.match(src,/merchantManualPaymentRoute\('cash'\)/);
assert.match(src,/merchantUpdatePaymentRoutesLive/);
assert.match(css,/\.merchant-psp-optional>summary:focus-visible/);
assert.match(css,/@media\(max-width:700px\)/);
assert.match(audit,/node tests\/merchant-easy-start-v1-270.mjs/);
console.log('V1.270 PASS: next-step merchant onboarding, optional PSPs, no forced banking connection.');
