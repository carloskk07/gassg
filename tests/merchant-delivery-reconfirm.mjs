import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const source=read('js/merchant.js'),backend=read('js/backend.js'),
  edge=read('supabase/functions/merchant-ops/index.ts'),
  ci=read('.github/workflows/audit.yml');
new vm.Script(source,{filename:'js/merchant.js'});
const start=source.indexOf('async function merchantLiveReconfirmDelivery(');
const end=source.indexOf('\nasync function merchantLiveSaveLogistics(',start);
assert.ok(start>=0&&end>start,'real freight handler exists');
const handler=source.slice(start,end);
assert.match(handler,/await merchantUpdateLogisticsLive\(fee,eta,true\)/);
assert.doesNotMatch(handler,/set-online|merchantSetOnlineLive|\.rpc\(|merchantInvoke\(|fetch\(/,
 'reconfirmation must only reuse the existing logistics mutation');
assert.match(backend,/async function merchantUpdateLogisticsLive\(/);
assert.match(backend,/await merchantConfigMutation\('update-logistics'/);
assert.match(backend,/expectedUpdatedAt/);
assert.match(edge,/if\(action==="update-logistics"\)/);
assert.match(ci,/node tests\/merchant-delivery-reconfirm\.mjs/);
assert.match(source,/merchantLiveReconfirmDelivery\(\)/);

const m={merchantId:'abc-merchant',memberRole:'owner',configUpdatedAt:'2026-10-20T00:00:00Z',
 deliveryFeeCents:800,baseEtaMinutes:30,acceptsCitywide:true,
 deliveryFeeConfirmedAt:'2026-10-10T12:00:00Z'};
const rt={status:'ready',actionPending:false,merchant:m};
const fields={
 'live-delivery-fee':{value:'8.00'},
 'live-eta':{value:'30'},
 'live-citywide':{checked:true}
};
let messages=[],calls=[],confirmed=true,fail=false,noRead=false,updateDuringConfirm=false;
const context=vm.createContext({
 globalThis:{merchantRuntime:rt},
 document:{getElementById:id=>fields[id]??null},
 BRL:{format:value=>'R$ '+Number(value).toFixed(2)},
 toast:x=>messages.push(String(x)),
 merchantTimestampFresh:timestamp=>{
  const t=Date.parse(timestamp||'');
  return Number.isFinite(t)&&Date.now()-t<=86400000&&t<=Date.now()+300000;
 },
 merchantUpdateLogisticsLive:async(fee,eta,citywide)=>{
  calls.push({fee,eta,citywide});
  if(fail)throw new Error('CONFIG_VERSION_CONFLICT');
  if(!noRead)m.deliveryFeeConfirmedAt=new Date().toISOString();
 },
 confirm:()=>{if(updateDuringConfirm)m.configUpdatedAt='2026-10-22T00:00:00Z';return confirmed;},
 Date,Math,Number,String
});
vm.runInContext(handler+'\nthis.reconfirm=merchantLiveReconfirmDelivery;',context);
assert.equal(await context.reconfirm(),true,'fresh server read allows success');
assert.equal(calls.length,1);
assert.equal(JSON.stringify(calls[0]),JSON.stringify({fee:800,eta:30,citywide:true}));
assert.match(messages.at(-1),/reconfirmados no sistema/);
m.deliveryFeeConfirmedAt='2026-10-10T12:00:00Z';
confirmed=false;
assert.equal(await context.reconfirm(),false);
assert.equal(calls.length,1,'cancel must not write');
confirmed=true;updateDuringConfirm=true;
assert.equal(await context.reconfirm(),false);
assert.equal(calls.length,1,'changed config version blocks mutation');
assert.match(messages.at(-1),/cadastro mudou/);
updateDuringConfirm=false;
fields['live-delivery-fee'].value='9.00';
assert.equal(await context.reconfirm(),false);
assert.equal(calls.length,1,'unsaved price changes must not be silently overwritten');
assert.match(messages.at(-1),/ainda não salvas/);
fields['live-delivery-fee'].value='8.00';
fields['live-citywide'].checked=false;
assert.equal(await context.reconfirm(),false);
assert.equal(calls.length,1,'changed delivery area must not be silently overwritten');
fields['live-citywide'].checked=true;
m.memberRole='operator';
assert.equal(await context.reconfirm(),false);
assert.equal(calls.length,1,'operator may not confirm freight');
m.memberRole='owner';
rt.actionPending=true;
assert.equal(await context.reconfirm(),false);
assert.equal(calls.length,1,'pending operation blocks concurrent update');
rt.actionPending=false;
rt.status='unauthenticated';
assert.equal(await context.reconfirm(),false);
rt.status='ready';
m.configUpdatedAt='';
assert.equal(await context.reconfirm(),false);
assert.match(messages.at(-1),/Atualize os dados/);
m.configUpdatedAt='2026-10-22T00:00:00Z';
m.acceptsCitywide=false;
assert.equal(await context.reconfirm(),false);
assert.equal(calls.length,1,'coverage cannot be enabled by reconfirmation');
m.acceptsCitywide=true;
m.deliveryFeeCents=-1;
assert.equal(await context.reconfirm(),false);
assert.equal(calls.length,1,'invalid price cannot be affirmed');
m.deliveryFeeCents=800;
noRead=true;
assert.equal(await context.reconfirm(),false,'without refreshed timestamp no success');
assert.match(messages.at(-1),/não foi reconferida/);
noRead=false;fail=true;
assert.equal(await context.reconfirm(),false);
assert.match(messages.at(-1),/CONFIG_VERSION_CONFLICT/);
assert.equal(calls.length,3,'each accepted confirmation attempts only the protected mutation');
console.log('PASS — freight attestation requires owner, unchanged form, user consent, server-confirmed freshness and handles conflicts.');
