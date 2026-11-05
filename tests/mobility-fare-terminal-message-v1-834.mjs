import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const src=fs.readFileSync(new URL('../js/mobility.js',import.meta.url),'utf8');
const ctx={console,Date,Intl,URL,URLSearchParams,FormData,
 BRL:new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}),
 document:{querySelector:()=>null,createElement:()=>({}),head:{appendChild(){}},addEventListener(){}},
 route:()=> 'mobility',esc:x=>String(x??'').replace(/</g,'&lt;'),
 CHAMA_BACKEND:{url:'https://test.invalid',publishableKey:'ci'}};
ctx.globalThis=ctx;
vm.runInNewContext(src,ctx);
const base={role:'driver',status:'completed',fare_cents:2500,
 fare_accepted:true,discount_cents:100,direct_due_cents:2400,fee_bps:800};
const done=ctx.mobilityFarePanel(base);
assert.match(done,/Pagamento direto ao motorista/);
assert.match(done,/Taxa TAMÃO prevista para esta corrida/);
assert.match(done,/pagamento diretamente ao motorista não verificado/);
for(const status of ['cancelled','rejected','expired']){
 for(const role of ['driver','rider']){
  const row={...base,status,role};
  const html=ctx.mobilityFarePanel(row);
  assert.match(html,/Atendimento encerrado sem conclusão/);
  assert.match(html,/Não há valor a pagar por esta solicitação pelo TAMÃO/);
  assert.doesNotMatch(html,/Taxa TAMÃO prevista para esta corrida/);
  assert.doesNotMatch(html,/Pagamento direto ao motorista:/);
  assert.match(html,/Benefício de R\$ 1 devolvido à carteira quando cabível/);
 }
}
assert.match(ctx.mobilityFarePanel({...base,status:'en_route'}),/Pagamento direto ao motorista/);
console.log('TAMÃO #834: cancelamento/expiração não anunciam pagamento ou taxa concluída.');
