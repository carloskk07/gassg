import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=(path)=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const sql=read('supabase/migrations/20261013235000_merchant_business_pulse_v1_231.sql');
const edge=read('supabase/functions/merchant-ops/index.ts');
const merchant=read('js/merchant.js');
const workflow=read('.github/workflows/audit.yml');
new vm.Script(merchant,{filename:'merchant.js'});
for(const invariant of [
  'merchant_business_pulse_v1_231',
  'security invoker',
  "mm.user_id=p_actor_user_id and mm.merchant_id=p_merchant_id",
  "mm.active and mm.member_role in ('owner','manager')",
  "o.merchant_id=p_merchant_id",
  "o.created_at>=v_now-interval '30 days'",
  "status='SETTLED' and financial_state='settled'",
  "o.status='SETTLED' and o.financial_state='settled'",
  'revoke all on function public.merchant_business_pulse_v1_231',
  'grant execute on function public.merchant_business_pulse_v1_231',
  'to service_role;',
  "'salesNotPlatformRevenue',true",
  "'adsBillingEnabled',false",
  "'proBillingEnabled',false",
  "'readOnly',true"
]) assert.ok(sql.includes(invariant),'missing SQL guarantee: '+invariant);
assert.ok(!/grant execute on function public\.merchant_business_pulse_v1_231[\s\S]*to\s+(?:anon|authenticated)/i.test(sql));
assert.ok(!/insert\s+into|update\s+public\.|delete\s+from/i.test(sql),'read-only function must not write');
for(const s of [
  '"business-pulse","growth-network"',
  'if(action==="business-pulse")',
  'if(!canManage(role))',
  'p_actor_user_id:user.id,p_merchant_id:merchantId',
  'data?.salesNotPlatformRevenue===true',
  'data?.adsBillingEnabled===false',
  'data?.proBillingEnabled===false'
])assert.ok(edge.includes(s),'missing merchant endpoint security: '+s);
for(const s of [
  'function merchantBusinessPulseSection(merchant)',
  'merchantBusinessPulseSection(m)',
  "merchantInvoke('merchant-ops',{merchantId:id,action:'business-pulse'})",
  "if(String(rt.merchant?.merchantId)!==id)return;",
  "rt.businessPulse?.merchantId===merchantId",
  'Atualizar meus números',
  'Sem reversão financeira',
  'não lucro'
])assert.ok(merchant.includes(s),'missing scoped merchant UI: '+s);
assert.ok(!/merchant_referral_reward_grants_v1_231|issue_payout|grant_reward/i.test(sql));
assert.match(workflow,/- name: TAMÃO Negócios V1\.231 business pulse and growth UX\s+run: node tests\/merchant-business-pulse-v1-231\.mjs/);
console.log('V1.231 PASS — scoped merchant business pulse, settled-only metrics, honest offer, no billing');
