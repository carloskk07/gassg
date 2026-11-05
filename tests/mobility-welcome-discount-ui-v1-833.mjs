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
vm.runInNewContext(src,ctx);
const base={role:'rider',status:'accepted',fare_cents:2500,fare_version:1,
 fare_accepted:false,welcome_eligible:true,discount_cents:0,direct_due_cents:2500};
const preview=ctx.mobilityFarePanel(base);
assert.match(preview,/benefício de boas-vindas de R\$ 1 pode ser aplicado/);
assert.match(preview,/24,00/);
assert.match(preview,/Confirmar valor da corrida/);
const noPromo=ctx.mobilityFarePanel({...base,welcome_eligible:false});
assert.doesNotMatch(noPromo,/boas-vindas de R\$ 1 pode ser aplicado/);
const paid=ctx.mobilityFarePanel({...base,fare_accepted:true,discount_cents:100,
 direct_due_cents:2400,fee_bps:800});
assert.match(paid,/Benefício TAMÃO/);
assert.match(paid,/25,00/);
assert.match(paid,/24,00/);
assert.match(paid,/-R\$\s*1,00/);
assert.doesNotMatch(paid,/Confirmar valor da corrida/);
const driver=ctx.mobilityFarePanel({...base,role:'driver',fare_accepted:true,
 discount_cents:100,direct_due_cents:2400,fee_bps:800});
assert.match(driver,/Taxa TAMÃO prevista para esta corrida: 8%/);
assert.match(driver,/24,00/);
const corrupt=ctx.mobilityFarePanel({...base,fare_accepted:true,discount_cents:100,
 direct_due_cents:2500});
assert.doesNotMatch(corrupt,/Benefício TAMÃO/);
const ledger=fs.readFileSync(new URL('../supabase/migrations/20261105042000_mobility_welcome_wallet_spend_v1_833.sql',import.meta.url),'utf8');
const price=fs.readFileSync(new URL('../supabase/migrations/20261105042100_mobility_welcome_net_receipts_v1_833.sql',import.meta.url),'utf8');
assert.match(ledger,/hashtextextended\('cashback-user:'/);
assert.match(ledger,/MOBILITY_WELCOME_RESERVE_UNRECONCILED/);
assert.match(ledger,/MOBILITY_WELCOME_RELEASE_UNRECONCILED/);
assert.match(ledger,/platform_cashback_trace_flows_v1_261/);
assert.match(ledger,/public.mobility_welcome_eligible_v1_833/);
assert.match(price,/discount_cents/);
assert.match(price,/MOBILITY_DISCOUNT_TERMS_CONFLICT/);
console.log('TAMÃO #833: desconto R$1, valor líquido e taxa exibidos somente por prova do servidor.');
