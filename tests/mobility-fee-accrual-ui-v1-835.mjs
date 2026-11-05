import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const src=fs.readFileSync(new URL('../js/mobility.js',import.meta.url),'utf8');
const ctx={console,Date,Intl,URL,URLSearchParams,FormData,
 BRL:new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}),
 document:{querySelector:()=>null,createElement:()=>({}),head:{appendChild(){}},addEventListener(){}},
 route:()=> 'mobility',esc:v=>String(v??'').replace(/</g,'&lt;'),
 CHAMA_BACKEND:{url:'https://ci.example',publishableKey:'test'}};
ctx.globalThis=ctx;
vm.runInNewContext(src+';this.runtime=mobilityRuntime;',ctx);
const rt=ctx.runtime,owner='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const benefits={eligibleDriver:true,version:2,normalFeeBps:900,memberFeeBps:800,
 termsText:'Contrato de opt-in',optedIn:true};
rt.user={id:owner};
rt.program={benefits,billing:{recordedCount:2,accruedCents:592,
 collectionStatus:'not_collected',entries:[
 {requestId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',service:'moto',
  netCents:2400,discountCents:100,feeBps:800,feeCents:192,
  collectionStatus:'not_collected',recordedAt:'2026-11-05T04:00:00Z'},
 {requestId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',service:'carro',
  netCents:5000,discountCents:0,feeBps:800,feeCents:400,
  collectionStatus:'not_collected',recordedAt:'2026-11-04T04:00:00Z'}]}};
const html=ctx.mobilityFeeLedgerPanel();
assert.match(html,/Taxas dos atendimentos concluídos/);
assert.match(html,/R\$\s*5,92/);
assert.match(html,/Pagamento não comprovado e cobrança ainda não disponibilizada/);
assert.match(html,/R\$\s*1,92/);
assert.match(html,/R\$\s*4,00/);
assert.match(html,/Atualizar extrato/);
assert.doesNotMatch(html,/Pagar agora|Taxa quitada|Gerar Pix/i);
rt.program.billing={...rt.program.billing,entries:[]};
assert.match(ctx.mobilityFeeLedgerPanel(),/Nenhuma taxa registrada até agora/);
rt.program.billing={...rt.program.billing,collectionStatus:'paid'};
assert.equal(ctx.mobilityFeeLedgerPanel(),'','Never claim paid without source proof');
rt.program=null;
assert.equal(ctx.mobilityFeeLedgerPanel(),'','Never leak previous account');
rt.program={benefits:{...benefits,eligibleDriver:false},
 billing:{recordedCount:5,accruedCents:100,collectionStatus:'not_collected',entries:[]}};
assert.equal(ctx.mobilityFeeLedgerPanel(),'','Rider cannot inspect driver fees');
const migration=fs.readFileSync(new URL('../supabase/migrations/20261105051500_mobility_fee_ledger_v1_835.sql',import.meta.url),'utf8');
for(const term of ['mobility_platform_fee_accruals_v1_835',
 'MOBILITY_FEE_RECEIPT_TERMS_CONFLICT','MOBILITY_FEE_ACCRUAL_IMMUTABLE',
 'payment_status','collection_status','mobility_fee_accrual_on_completed_v1_835_trg',
 'mobility_billing_catalog_v1_826()','revoke all on public.mobility_platform_fee_accruals_v1_835'])
 assert.ok(migration.includes(term),term);
assert.ok(!/insert into public.merchant_billing_payment_events/i.test(migration));
console.log('TAMÃO #835: extrato privado mostra somente taxa registrada, sem pagamento inventado.');
