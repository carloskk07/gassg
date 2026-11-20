import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const client=read('js/admin-ads-credit.js');
assert.doesNotThrow(()=>new vm.Script(client));
const audit=read('.github/workflows/audit.yml');
assert.ok(audit.includes('tests/ads-credit-admin-ux-v1-1099.mjs'));

const first='11111111-1111-4111-8111-111111111111';
const second='22222222-2222-4222-8222-222222222222';
const third='33333333-3333-4333-8333-333333333333';
const row=(id,status,title)=>({id,status,title,advertiser:'Empresa regional',
 description:'Conheça a empresa e seus serviços',destination:'https://example.com',
 city:'São Gabriel',state:'RS',views:0,version:1,createdAt:'2026-11-20'});
const fields={};
let selection='reject',renders=0;
const messages=[],calls=[];
const context={
 adminRuntime:{section:'ads',session:{user:{id:'owner'}}},
 adminReady:()=>true,adminCurrentRole:()=> 'superadmin',
 adminMoney:cents=>'R$ '+(cents/100).toFixed(2),
 adminAccessToken:async()=> 'test-token',CHAMA_BACKEND:{url:'https://invalid.example',publishableKey:'test'},
 esc:value=>String(value).replaceAll('<','&lt;').replaceAll('>','&gt;'),
 document:{
  getElementById:id=>fields[id]||null,
  querySelector:()=>({value:selection})
 },
 render:()=>{renders++},toast:msg=>{messages.push(msg);return false},
 console
};
vm.createContext(context);
vm.runInContext(client,context);
context.testData={actor:'owner',status:'ready',
 rows:[row(second,'active','Campanha ativa'),row(first,'submitted','Campanha em análise'),
       row(third,'paused','Campanha pausada')],
 gate:{centsPerView:2,rechargeEnabled:false,billingEnabled:false,evidenceEnabled:false},
 totals:{wallets:0,loaded:0,spent:0,remaining:0},error:''};
vm.runInContext('adminCreditAdsState=testData;',context);
let html=context.adminCreditAdsPanel();
assert.match(html,/3\)<\/option>/);
assert.match(html,/1 aguardando revisão/);
assert.ok(html.indexOf('Campanha em análise')<html.indexOf('Campanha ativa'),
 'Submitted campaigns must be reviewed before active ones');
assert.ok(html.includes('Motivo da decisão'));
assert.ok(!html.includes('Retomar com saldo'),'Closed delivery must not offer an unavailable resumption');
context.testData.gate={centsPerView:2,rechargeEnabled:true,billingEnabled:true,evidenceEnabled:true};
assert.ok(context.adminCreditAdsPanel().includes('Retomar com saldo'));
context.testData.gate={centsPerView:2,rechargeEnabled:false,billingEnabled:false,evidenceEnabled:false};
assert.ok(html.includes('Obrigatório para rejeitar ou encerrar'));
assert.ok(html.includes('Recargas desligadas · Débitos desligados'));
assert.equal(context.adminCreditAdsChooseFilter('fake'),false);
assert.equal(context.adminCreditAdsChooseFilter('submitted'),true);
assert.equal(renders,1);
html=context.adminCreditAdsPanel();
assert.ok(html.includes('Campanha em análise'));
assert.ok(!html.includes('Campanha ativa'));
assert.ok(!html.includes('Campanha pausada'));
assert.equal(context.adminCreditAdsChooseFilter('all'),true);
context.adminCreditAdsRequest=async(action,body)=>{
 calls.push({action,body});
 return {source:'ads_credit_admin_action_v1_1098',campaignId:body.campaignId};
};
context.adminCreditAdsRefresh=async()=>true;
fields['credit-ack-'+first]={checked:true};
fields['credit-reason-'+first]={value:''};
assert.equal(await context.adminCreditAdsDecide(first,1),false);
assert.equal(calls.length,0,'Reject without explanatory reason must fail closed');
fields['credit-reason-'+first]={value:'  Conteúdo não atende aos critérios   de publicação.  '};
assert.equal(await context.adminCreditAdsDecide(first,1),true);
assert.equal(calls.length,1);
assert.equal(calls[0].body.decision,'reject');
assert.equal(calls[0].body.reason,'Conteúdo não atende aos critérios de publicação.');
selection='approve';
fields['credit-reason-'+first]={value:'Motivo opcional'};
assert.equal(await context.adminCreditAdsDecide(first,2),false,
 'Stale version must fail before requesting an admin mutation');
assert.equal(calls.length,1);
assert.equal(context.adminCreditAdsChooseFilter('active'),true);
// The Admin pilot is read-only on entry. A real receipt needs its own
// selection, the same rendered session and the fixed server-side amount.
const pilotCalls=[];
let pilotData={source:'admin_ads_credit_pilot_v1_1101',status:'idle',canStart:true,providerReady:true,topupId:null,amountCents:1990,balanceCents:0};
context.adminCreditAdsRequest=async(action,body={})=>{
 pilotCalls.push({action,body});
 if(action==='admin-pilot-read')return pilotData;
 assert.equal(action,'admin-pilot-prepare');
 pilotData={...pilotData,canStart:false,status:'pix_pending',topupId:first,pixCode:'test-code',
  expiresAt:new Date(Date.now()+86400000).toISOString()};
 return {source:'ads_credit_topup_v1_1097',status:'pix_pending'};
};
const scope=context.adminCreditPilotScope();
await context.adminCreditPilotRead(scope);
assert.match(context.adminCreditPilotPanel(),/Gerar Pix de R\$ 19,90/);
assert.deepEqual(pilotCalls.map(x=>x.action),['admin-pilot-read']);
pilotData.providerReady=false;assert.ok(!context.adminCreditPilotPanel().includes('Gerar Pix de R$ 19,90'));
pilotData.providerReady=true;
assert.equal(await context.adminCreditPilotRun('prepare','',scope.revision),false);
fields['credit-pilot-consent']={checked:true};
assert.equal(await context.adminCreditPilotRun('prepare','',scope.revision+1),false);
assert.equal(await context.adminCreditPilotRun('prepare','',scope.revision),true);
assert.equal(pilotCalls.filter(x=>x.action==='admin-pilot-prepare').length,1);
context.tamaoPixCodeValid=()=>true;context.tamaoPixMarkup=()=>'<svg aria-label="QR Code"></svg>';
assert.match(context.adminCreditPilotPanel(),/QR Code/);
assert.match(context.adminCreditPilotPanel(),/Copiar Pix/);
assert.ok(!context.adminCreditPilotPanel().includes('Gerar Pix de R$ 19,90'));
context.adminCurrentRole=()=> 'finance';
assert.equal(context.adminCreditPilotPanel(),'');
assert.equal(await context.adminCreditPilotRun('prepare','',scope.revision),false);
console.log('PASS V1.1099: admin Ads moderation priority, exact status filtering, real rejection reason, stale-version guard and disabled billing visibility.');
