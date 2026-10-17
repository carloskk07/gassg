import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const admin=read('js/admin.js');
const edge=read('supabase/functions/admin-ops/index.ts');
const submit=read('supabase/functions/submit-merchant-application/index.ts');
const backend=read('js/backend.js');
new vm.Script(admin,{filename:'js/admin.js'});

assert.ok(admin.includes('id="${prefix}-state"'),'Pilot form must expose UF');
assert.ok(admin.includes('Atende toda a cidade informada'),'City-wide service must not assume São Gabriel');
assert.ok(!admin.includes("state:'RS',\n      ownerUserId,"),
  'Pilot conversion must send selected UF rather than hardcoded RS');
assert.ok(edge.includes('state:cleanText(body.state??"RS"'),
  'Admin API must validate an explicit UF');
assert.ok(submit.includes('claim_pilot_partner_invite'),
  'Permanent account must claim pilot invitation');
assert.ok(backend.includes('function merchantPilotInviteFromUrl()') &&
          backend.includes('merchantPilotInviteToken();'),
  'Merchant auth journey must preserve the invite across email sign-in');

const start=admin.indexOf('async function adminConvertPilotPartner(');
const end=admin.indexOf('function adminFocusPilotFromApplication(',start);
assert.ok(start>=0&&end>start);
const source=admin.slice(start,end);
const inputs={
  legal:'Empresa Teste Ltda',cnpj:'12345678000100',responsible:'Ana Souza',
  phone:'559999999999',whatsapp:'559999999999',postal:'88000000',
  city:'Florianópolis',state:'SC',address:'Rua Exemplo, 10',
  stock:'0',fee:'0',eta:'30',radius:'',notes:'Teste sem operação real',
  'owner-name':'Ana Souza'
};
const partner={
  id:'pilot-01',onboarding_status:'ready_for_review',
  onboarding:{ownerClaimed:true,application:{id:'app-01',status:'pending'}},
  display_name:'Loja Piloto',proposed_product_code:'P13',
  proposed_delivered_price_cents:10000,min_delivered_price_cents:10000,
  preferred_delivered_price_cents:10000,max_delivered_price_cents:10000,
  pricing_mode:'fixed',pricing_strategy:'balanced'
};
let performCalls=[],toasts=[],confirmCalls=0;
const ctx=vm.createContext({
  adminRuntime:{data:{pilotPartners:[partner]}},
  document:{getElementById:id=>{const suffix=id.slice('pilot-pilot-01-'.length);return {value:inputs[suffix]??'',checked:false};}},
  adminProductName:()=> 'Gás GLP P13',
  adminPerform:async(action,payload)=>{performCalls.push({action,payload});return {alreadyConverted:false};},
  toast:text=>{toasts.push(text);},
  confirm:()=>{confirmCalls++;return true;}
});
vm.runInContext(source+'\nthis.convertPilot=adminConvertPilotPartner;',ctx);

await ctx.convertPilot('pilot-01');
assert.equal(performCalls.length,1);
assert.equal(performCalls[0].action,'assisted-merchant-onboarding');
assert.equal(performCalls[0].payload.state,'SC','Explicit state must reach admin API');
assert.equal(performCalls[0].payload.city,'Florianópolis');
assert.equal(performCalls[0].payload.ownerUserId,null,'Owner remains determined by server-side claim');
assert.equal(performCalls[0].payload.availableStock,0);
assert.ok(!Object.hasOwn(performCalls[0].payload,'online'));
assert.ok(!Object.hasOwn(performCalls[0].payload,'status'));

inputs.state='zz';
await ctx.convertPilot('pilot-01');
assert.equal(performCalls.length,1,'Invalid UF must not submit');
assert.ok(toasts.some(x=>x.includes('UF brasileira válida')));
inputs.state='RS';
inputs.city='São Gabriel';
await ctx.convertPilot('pilot-01');
assert.equal(performCalls.length,2);
assert.equal(performCalls[1].payload.state,'RS');

partner.onboarding.ownerClaimed=false;
await ctx.convertPilot('pilot-01');
assert.equal(performCalls.length,2,'Unclaimed invitation must never submit');
assert.ok(toasts.some(x=>x.includes('reivindicação')));
partner.onboarding.ownerClaimed=true;
partner.onboarding.application.status='rejected';
await ctx.convertPilot('pilot-01');
assert.equal(performCalls.length,2,'Rejected application must never submit');
partner.onboarding.application.status='approved';
partner.onboarding_status='converted';
await ctx.convertPilot('pilot-01');
assert.equal(performCalls.length,2,'Converted pilot must never submit twice');
partner.onboarding_status='cancelled';
await ctx.convertPilot('pilot-01');
assert.equal(performCalls.length,2,'Cancelled pilot must never submit');
assert.equal(confirmCalls,2,'Only allowed conversions reach confirmation');
assert.ok(read('.github/workflows/audit.yml').includes('node tests/pilot-operational-journey-v1-403.mjs'));
console.log('V1.403: geography, claim preflight, pending/offline behavior and blocked replays passed.');
