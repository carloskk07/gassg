import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const admin=read('js/admin-acquisition.js');
const shell=read('js/admin.js');
const edge=read('supabase/functions/admin-ops/index.ts');
const migration=read('supabase/migrations/20261111120000_welcome_campaign_control_v1_948.sql');
for(const [name,source] of Object.entries({admin,shell}))new vm.Script(source,{filename:name+'.js'});
for(const part of [
 'admin_welcome_campaign_read_v1_948','admin_welcome_campaign_manage_v1_948',
 "p_operation not in ('pause','resume','end')",
 "v_c.ended_at is not null and p_operation<>'end'",
 'for update','WELCOME_REQUEST_REPLAY_CONFLICT',
 'WELCOME_LEDGER_RECONCILIATION_REQUIRED',
 'platform_admin_audit','grant execute on function public.admin_welcome_campaign',
 "to service_role",
])assert.ok(migration.toLowerCase().includes(part.toLowerCase()),'SQL '+part);
assert.doesNotMatch(migration,/insert into public.wallet_entries|insert into public.platform_welcome_grants_v1_815|mercadopago|create.*pix/i);
assert.match(edge,/if\(action==="welcome-campaign-read"\)/);
assert.match(edge,/if\(action==="welcome-campaign-manage"\)/);
assert.match(edge,/p_request:uuid\(body.requestId,"requestId"\)/);
assert.match(shell,/adminWelcomeCampaignLoad\(\{silent:true\}\)/);
assert.match(admin,/adminWelcomeCampaignView\(\)/);
assert.match(admin,/adminWelcomeCampaignManage\(operation\)/);
assert.match(read('.github/workflows/isolated-supabase-integration.yml'),
 /tests\/isolated-welcome-first100-lifecycle-v1-948\.mjs/);
const begin=admin.indexOf('// V1.948 — campaign owner controls,');
const end=admin.indexOf('function adminPrelaunchLeadsSection(data)',begin);
assert.ok(begin>0&&end>begin);
const src=admin.slice(begin,end);
let role='superadmin',confirmed=true,serverEnabled=true,ended=false,awarded=3,
 renderCount=0,invocations=[],toasts=[];
const actor='11111111-1111-4111-8111-111111111111';
const reply=()=>({
 source:'admin_welcome_campaign_read_v1_948',
 readOnly:true,noCharge:true,pspCashVerified:false,
 funding:'owner_promotional_commitment_not_bank_receipt',
 campaignKey:'welcome_2026_815',awardCents:100,budgetCents:10000,maxAwards:100,
 awardedCount:awarded,awardedCents:awarded*100,remainingAwards:100-awarded,
 lotRemainingCents:awarded*100,notAvailableCents:0,
 enabled:serverEnabled,ended,history:[]
});
const ctx=vm.createContext({
 adminRuntime:{status:'ready',section:'growth',session:{user:{id:actor}}},
 adminRoleCanSection:()=>true,adminCurrentRole:()=>role,
 adminInvoke:async payload=>{
  invocations.push({...payload});
  if(payload.action==='welcome-campaign-read')return reply();
  assert.equal(payload.action,'welcome-campaign-manage');
  assert.ok(['pause','resume','end'].includes(payload.operation));
  assert.equal(payload.expectedAwarded,awarded);
  assert.equal(payload.expectedEnabled,serverEnabled);
  if(payload.operation==='pause')serverEnabled=false;
  if(payload.operation==='resume')serverEnabled=true;
  if(payload.operation==='end'){serverEnabled=false;ended=true}
  return {source:'admin_welcome_campaign_manage_v1_948',
   noCharge:true,replayed:false,enabled:serverEnabled,ended,awardedCount:awarded};
 },
 render:()=>{renderCount++},toast:s=>toasts.push(s),
 window:{confirm:()=>confirmed},
 crypto:{randomUUID:()=> '22222222-2222-4222-8222-222222222222'},
 esc:s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;'),
 Intl,Date,Number,String,Array,Object,console
});
vm.runInContext(src+"\nthis.welcome={load:adminWelcomeCampaignLoad,view:adminWelcomeCampaignView,manage:adminWelcomeCampaignManage,get:()=>adminWelcomeCampaignState};",ctx);
let html=ctx.welcome.view();
assert.match(html,/Conferir campanha/);
assert.doesNotMatch(html,/Pausar novos bônus/,'no mutation before readback');
assert.equal(invocations.length,0);
await ctx.welcome.load();
html=ctx.welcome.view();
assert.match(html,/3 \/ 100/);
assert.match(html,/Pausar novos bônus/);
assert.match(html,/Encerrar definitivamente/);
assert.match(html,/não é depósito Pix/);
assert.equal(invocations.length,1);
await ctx.welcome.manage('pause');
assert.deepEqual(invocations.map(x=>x.action),['welcome-campaign-read','welcome-campaign-manage','welcome-campaign-read']);
assert.equal(serverEnabled,false);
assert.match(ctx.welcome.view(),/Reativar bônus/);
await ctx.welcome.manage('resume');
assert.equal(serverEnabled,true);
confirmed=false;
await ctx.welcome.manage('end');
assert.equal(ended,false,'no permanent end without explicit confirmation');
confirmed=true;
await ctx.welcome.manage('end');
assert.equal(ended,true);
assert.doesNotMatch(ctx.welcome.view(),/Reativar bônus/);
const before=invocations.length;
role='finance';
await ctx.welcome.manage('pause');
assert.equal(invocations.length,before,'finance role cannot mutate first 100');
role='readonly';
assert.equal(ctx.welcome.view(),'','readonly must not receive financial data');
assert.ok(renderCount>2);
assert.ok(invocations.every(x=>!x.amountCents&&!x.paymentId&&!x.pix),
 'no PSP or money-movement input');
console.log('V1.948 PASS: owner-only audit controls, explicit irreversible end, guarded readback and no payments.');
