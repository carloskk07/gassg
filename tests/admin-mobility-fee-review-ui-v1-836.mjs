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
const render=obj=>context.adminMobilityBillingSection({mobilityBilling:obj});
let html=render(data);
assert.match(html,/Taxas de atendimento/);
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
assert.match(edgeSrc,/\["superadmin","finance","readonly"\]\.includes\(actorRole\)/);
assert.match(edgeSrc,/mobilityBilling:mobilityFeeReview\.data\?\?null/);
assert.match(adminSrc,/adminFinanceRenderPart\('Taxas de moto e carro',\(\)=>adminMobilityBillingSection\(d\)\)/);
const sql=fs.readFileSync(new URL('../supabase/migrations/20261105130000_admin_mobility_fee_review_v1_836.sql',import.meta.url),'utf8');
for(const required of ['platform_admin_role','ADMIN_MOBILITY_FEE_READ_DENIED','revoke all','to service_role',
 'missingEntryCount','integrityIssues','paymentVerified','database_full'])
 assert.ok(sql.includes(required),required);
assert.ok(!sql.includes('grant execute on function public.admin_mobility_fee_review_v1_836(uuid)\n to authenticated'));
console.log('TAMÃO #836: Financeiro somente autorizado, totais íntegros, nenhum pagamento fictício.');
