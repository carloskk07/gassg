import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=read('supabase/migrations/20261014233000_owner_receipt_orphan_cleanup_v1_258.sql');
const edge=read('supabase/functions/admin-ops/index.ts');
const patch=read('supabase/migrations/20261014233500_owner_receipt_orphan_replay_guard_v1_258.sql');
const ui=read('js/admin-acquisition.js');
const boot=read('js/bootstrap.js');
const audit=read('.github/workflows/audit.yml');
for(const x of [
 'platform_campaign_receipt_cleanup_requests_v1_258',
 'platform_campaign_receipt_cleanup_results_v1_258',
 'platform_funding_private_v1_258.candidates',
 'platform_funding_private_v1_258.reserve',
 'platform_funding_private_v1_258.finish',
 'public.admin_owner_cleanup_candidates_v1_258',
 'public.admin_owner_cleanup_reserve_v1_258',
 'public.admin_owner_cleanup_finish_v1_258',
 'ORPHAN_CLEANUP_WRITE_DENIED',
 "a.admin_role='superadmin'",
 "o.created_at<=clock_timestamp()-interval '24 hours'",
 "r.object_path=o.name",
 "req.requested_at>clock_timestamp()-interval '15 minutes'",
 'pg_catalog.pg_advisory_xact_lock',
 'ORPHAN_CLEANUP_NOT_ELIGIBLE',
 'ORPHAN_CLEANUP_OBJECT_STILL_PRESENT',
 'ORPHAN_CLEANUP_REPLAY_UNSAFE',
 'o.id=v_old.object_id',
 'o.name=v_old.object_path',
 'RECEIPT_OBJECT_UNAVAILABLE',
 "'automaticDeletionEnabled',false",
 "'noObjectPaths',true",
 "'deletionPerformed',false",
 'enable row level security',
 'ORPHAN_CLEANUP_ACL_DRIFT'
])assert.ok(sql.includes(x),'Missing invariant: '+x);
assert.ok(!/delete\s+from\s+storage\.objects/i.test(sql));
assert.ok(patch.includes('ORPHAN_CLEANUP_REPLAY_UNSAFE'));
assert.ok(patch.includes('o.name=v_old.object_path'));
assert.ok(sql.includes('not exists (\n   select 1 from storage.objects o'));
assert.ok(edge.includes('if(action==="owner-orphan-cleanup-candidates")'));
assert.ok(edge.includes('if(action==="owner-orphan-cleanup-delete")'));
assert.ok(edge.includes('body.confirm!=="EXCLUIR"'));
assert.ok(edge.includes('.remove([reserved.objectPath])'));
assert.ok(edge.includes('p_outcome:"absent_confirmed"'));
assert.ok(edge.includes('p_outcome:"failed"'));
assert.ok(boot.includes('adminOwnerOrphanCleanupLoadFromUi,adminOwnerOrphanCleanupDeleteFromUi'));
assert.ok(audit.includes('node tests/owner-receipt-orphan-cleanup-v1-258.mjs'));
new vm.Script(ui,{filename:'admin-acquisition.js'});
new vm.Script(boot,{filename:'bootstrap.js'});
const actor='11111111-1111-4111-8111-111111111111';
const object='22222222-2222-4222-8222-222222222222';
const fixture={source:'admin_owner_cleanup_candidates_v1_258',
 rows:[{objectId:object,createdAt:'2026-10-10T14:00:00Z'}],
 totalCandidates:1,limit:20,truncated:false,minAgeHours:24,
 readOnly:true,privateBucket:true,noObjectPaths:true,
 automaticDeletionEnabled:false,deletionPerformed:false};
let role='superadmin',requests=[],toasts=[],typed='';
const ctx=vm.createContext({
 adminRuntime:{session:{user:{id:actor}}},adminCurrentRole:()=>role,
 document:{getElementById:()=>({value:typed})},
 adminInvoke:async p=>{requests.push(p);return p.action==='owner-orphan-cleanup-candidates'?fixture:{
  source:'admin_owner_cleanup_deleted_v1_258',
  objectAbsentConfirmed:true,oneObjectOnly:true,automaticDeletionEnabled:false,
  auditRecorded:true,linkedReceiptDeleted:false,objectPathsExposed:false};},
 crypto:{randomUUID:()=> '33333333-3333-4333-8333-333333333333'},
 adminOwnerOrphanAuditLoadFromUi:async()=>{},
 toast:s=>toasts.push(s),render:()=>{},
 esc:s=>String(s),Number,String,Array,Date
});
const start=ui.indexOf('// TAMÃO V1.258 —');
const end=ui.indexOf('// TAMÃO V1.257 —',start);
assert.ok(start>=0&&end>start);
vm.runInContext(ui.slice(start,end),ctx);
await ctx.adminOwnerOrphanCleanupLoadFromUi();
assert.equal(requests[0].action,'owner-orphan-cleanup-candidates');
assert.ok(ctx.adminOwnerOrphanCleanupSection().includes('Digite EXCLUIR'));
await ctx.adminOwnerOrphanCleanupDeleteFromUi(object);
assert.equal(requests.length,1);
typed='EXCLUIR';role='finance';
await ctx.adminOwnerOrphanCleanupDeleteFromUi(object);
assert.equal(requests.length,1);
role='superadmin';
await ctx.adminOwnerOrphanCleanupDeleteFromUi(object);
assert.equal(requests[1].action,'owner-orphan-cleanup-delete');
assert.equal(requests[1].confirm,'EXCLUIR');
assert.equal(requests.length,3);
ctx.adminRuntime.session.user.id='44444444-4444-4444-8444-444444444444';
assert.ok(!ctx.adminOwnerOrphanCleanupSection().includes(object));
ctx.adminRuntime.session.user.id=actor;fixture.deletionPerformed=true;
await ctx.adminOwnerOrphanCleanupLoadFromUi();
assert.ok(toasts.some(s=>s.includes('não verificada')));
console.log('V1.258 PASS — 24h filter, manual single-object deletion, append-only audit, role check, no resurrected attachments.');
