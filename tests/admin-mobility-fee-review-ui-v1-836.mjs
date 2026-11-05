import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const adminSrc=fs.readFileSync(new URL('../js/admin.js',import.meta.url),'utf8');
const edgeSrc=fs.readFileSync(new URL('../supabase/functions/admin-ops/index.ts',import.meta.url),'utf8');
const start=adminSrc.indexOf('function adminMobilityBillingSection(d){');
const end=adminSrc.indexOf('function adminMerchantBillingSection(d){',start+5);
assert.ok(start>=0&&end>start);
const fn=adminSrc.slice(start,end);
let role='superadmin';
const context={Number,Array,String,esc:s=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'),
 adminCurrentRole:()=>role,
 adminMoney:c=>(Number(c)/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}),
 formatDateTime:s=>String(s).slice(0,10)};
vm.runInNewContext(fn,context);
const data={source:'database_full',collectionStatus:'not_collected',paymentVerified:false,
 recordedCount:2,driverCount:1,accruedCents:552,collectedCents:0,outstandingCents:552,
 integrityIssues:0,ninePercent:{count:1,cents:360},eightPercent:{count:1,cents:192},
 benefitsCents:100,
 recentDrivers:[{driverId:'11111111-1111-4111-8111-111111111111',rides:2,accruedCents:552}],
 recentEntries:[{requestId:'22222222-2222-4222-8222-222222222222',
 driverId:'11111111-1111-4111-8111-111111111111',service:'moto',netCents:2400,feeBps:800,feeCents:192,
 collectionStatus:'not_collected',recordedAt:'2026-11-05T04:00:00Z'}]};
const disputeFixture={source:'psp_review_queue',total:2,truncated:false,cases:[
 {id:'33333333-3333-4333-8333-333333333333',driver_id:'11111111-1111-4111-8111-111111111111',
  invoice_kind:'prepaid_credit',plan_key:'essential',amount_cents:990,
  external_reference:'mobility-fee:33333333-3333-4333-8333-333333333333',
  provider_order_id:'ord-verified',provider_payment_id:'pay-verified',
  review_at:'2026-11-05T15:00:00Z',created_at:'2026-11-05T14:00:00Z',paid_at:'2026-11-05T14:30:00Z'},
 {id:'44444444-4444-4444-8444-444444444444',driver_id:'55555555-5555-4555-8555-555555555555',
  invoice_kind:'fee',plan_key:null,amount_cents:155,
  external_reference:'mobility-fee:44444444-4444-4444-8444-444444444444',
  provider_order_id:'ord-fee',provider_payment_id:'pay-fee',review_at:'2026-11-05T15:02:00Z'}]};
const render=(obj,disputes=disputeFixture)=>context.adminMobilityBillingSection({
 mobilityBilling:obj,mobilityDisputes:disputes});
let html=render(data);
assert.match(html,/Taxas de atendimento/);
assert.match(html,/Contestações Pix/);
assert.ok(html.includes('2 fatura(s)'));
assert.match(html,/Recarga de plano/);
assert.match(html,/Taxa de corridas/);
assert.ok(html.includes('9,90'));
assert.match(html,/sem marcação automática|Nenhuma contestação é automaticamente/);
assert.doesNotMatch(html,/Marcar pago|Resolver contestação|Reemitir Pix/i);
let unsafe=render(data,{...disputeFixture,cases:[
 {...disputeFixture.cases[0],provider_order_id:'<script>alert(1)</script>'},
 disputeFixture.cases[1]]});
assert.doesNotMatch(unsafe,/<script>/);
unsafe=render(data,{source:'psp_review_queue',total:1,cases:[{...disputeFixture.cases[0],amount_cents:-1}]});
assert.match(unsafe,/fila de revisão financeira não foi confirmada/);
unsafe=render(data,{source:'psp_review_queue',total:51,truncated:true,cases:disputeFixture.cases});
assert.match(unsafe,/50 contestações mais antigas/);
unsafe=render(data,{source:'psp_review_queue',total:0,truncated:false,cases:[]});
assert.match(unsafe,/Nenhuma contestação pendente/);
assert.match(html,/R\$\s*5,52/);
assert.match(html,/R\$\s*1,92/);
assert.match(html,/R\$\s*3,60/);
assert.match(html,/a receber/);
assert.match(html,/Conferência com o provedor/);
assert.match(html,/LIVRO-RAZÃO CONFERIDO/);
assert.doesNotMatch(html,/Marcar pago|Criar Pix|Confirmar quitação/i);
html=render({...data,recentEntries:[{...data.recentEntries[0],driverId:'<script>x</script>'}]});
assert.doesNotMatch(html,/<script>/,'escape untrusted data');
html=render({...data,integrityIssues:1});
assert.match(html,/DIVERGÊNCIAS/);
html=render({...data,collectedCents:552});
assert.match(html,/não passaram na validação/,'reject inconsistent payment totals');
role='operations';
assert.equal(render(data),'','operations must not see finance');
role='finance';
assert.match(render(data),/Taxas de atendimento/);
role='readonly';
assert.match(render(data),/Taxas de atendimento/);
assert.match(edgeSrc,/admin_mobility_fee_review_v1_836/);
assert.match(edgeSrc,/mobility_fee_pix_invoices_v1_837/);
assert.ok(edgeSrc.includes('mobilityDisputeAccess=Boolean(currentAdmin?.active)'));
assert.ok(edgeSrc.includes('.eq("status","review_required")'));
assert.ok(edgeSrc.includes('.order("review_at",{ascending:true})'));
assert.match(edgeSrc,/mobilityDisputes:mobilityDisputeAccess/);
assert.match(edgeSrc,/MOBILITY_DISPUTE_REVIEW_UNAVAILABLE/);
assert.match(edgeSrc,/\["superadmin","finance","readonly"\]\.includes\(actorRole\)/);
assert.match(edgeSrc,/mobilityBilling:mobilityFeeReview\.data\?\?null/);
assert.match(adminSrc,/adminFinanceRenderPart\('Taxas de moto e carro',\(\)=>adminMobilityBillingSection\(d\)\)/);
const sql=fs.readFileSync(new URL('../supabase/migrations/20261105130000_admin_mobility_fee_review_v1_836.sql',import.meta.url),'utf8');
for(const required of ['platform_admin_role','ADMIN_MOBILITY_FEE_READ_DENIED','revoke all','to service_role',
 'missingEntryCount','integrityIssues','paymentVerified','database_full'])
 assert.ok(sql.includes(required),required);
assert.ok(!sql.includes('grant execute on function public.admin_mobility_fee_review_v1_836(uuid)\n to authenticated'));
console.log('TAMÃO #836: Financeiro somente autorizado, totais íntegros, nenhum pagamento fictício.');
