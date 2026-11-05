import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../js/mobility.js',import.meta.url),'utf8');
const ctx={console,Date,Intl,URL,URLSearchParams,FormData,BRL:new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}),
 document:{querySelector:()=>null,createElement:()=>({}),head:{appendChild(){}},addEventListener(){}},
 route:()=> 'mobility',esc:v=>String(v??'').replace(/</g,'&lt;'),
 CHAMA_BACKEND:{url:'https://sandbox.test',publishableKey:'local'},
 globalThis:null};
ctx.globalThis=ctx;
new vm.Script(source);
vm.runInNewContext(source,ctx);
const quote={role:'driver',status:'accepted',fare_cents:null,fare_accepted:false};
assert.match(ctx.mobilityFarePanel(quote),/Enviar valor ao passageiro/);
assert.match(ctx.mobilityFarePanel({...quote,fare_cents:2500}),/25,00/);
assert.match(ctx.mobilityFarePanel({...quote,role:'rider',fare_cents:2500,fare_version:1}),/Confirmar valor da corrida/);
assert.doesNotMatch(ctx.mobilityFarePanel({...quote,role:'rider'}),/Confirmar valor da corrida/);
const accepted=ctx.mobilityFarePanel({...quote,role:'rider',fare_cents:2500,fare_version:1,fare_accepted:true});
assert.match(accepted,/Valor combinado/);
assert.doesNotMatch(accepted,/Confirmar valor/);
assert.match(source,/mobility_fare_propose_v1_826/);
assert.match(source,/mobility_fare_accept_v1_826/);
assert.match(source,/fare_version!==version/);
assert.match(source,/sessionEpoch===epoch/);
assert.match(source,/prevFare!==JSON.stringify/);
const migration=fs.readFileSync(new URL('../supabase/migrations/20261104224500_mobility_fares_and_billing_options_v1_826.sql',import.meta.url),'utf8');
assert.ok(migration.includes('purchase_enabled boolean not null default false'));
assert.ok(migration.includes('MOBILITY_FARE_CHANGED_REVIEW_REQUIRED'));
assert.ok(migration.includes('MOBILITY_FARE_ALREADY_ACCEPTED'));
assert.ok(!migration.includes('insert into public.wallet_entries'),'sem crédito falso');
assert.ok(!migration.includes('insert into public.platform_receivables'),'sem taxa de corrida inventada');
const driverWaiting={...quote,id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',service:'moto',origin:'Centro',destination:'Bairro',fare_cents:1990,fare_accepted:false};
const waitingUi=ctx.mobilityDetailPanel(driverWaiting);
assert.match(waitingUi,/aguarde o passageiro confirmar/);
assert.doesNotMatch(waitingUi,/Iniciar deslocamento/);
const confirmedUi=ctx.mobilityDetailPanel({...driverWaiting,fare_accepted:true});
assert.match(confirmedUi,/Iniciar deslocamento/);
const gate=fs.readFileSync(new URL('../supabase/migrations/20261105031500_mobility_price_gate_v1_828.sql',import.meta.url),'utf8');
assert.match(gate,/MOBILITY_FARE_NOT_ACCEPTED/);
assert.match(gate,/rider_accepted_at is not null/);
assert.match(gate,/alter column fare_confirmation_required set default true/);
assert.match(gate,/new\.fare_confirmation_required:=true/);
console.log('TAMÃO #826: UI de proposta/aceite, isolamento e catálogo seguro validados.');
