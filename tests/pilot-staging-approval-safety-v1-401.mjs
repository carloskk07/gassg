import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const original=read('supabase/migrations/20261004185000_pilot_partner_invite_v1_69.sql');
const guarded=read('supabase/migrations/20261017222119_pilot_staging_approval_conflict_guards_v1_401.sql');
const fnName='create or replace function public.admin_approve_merchant_application(';
function extract(source){
  const start=source.toLowerCase().indexOf(fnName);
  assert.ok(start>=0,'Approval RPC missing');
  const section=source.slice(start);
  const block=section.match(/\bas\s+(\$\w*\$)([\s\S]*?)\1\s*;/i);
  assert.ok(block,'Expected dollar-quoted SQL body');
  return section.slice(0,block.index+block[0].length);
}
const before=extract(original), after=extract(guarded);
const grant="  insert into public.merchant_members(\n    merchant_id,user_id,member_role,active\n  )";
assert.ok(before.includes(grant));
const newGrant="  -- A claimed PILOT draft must never downgrade a live merchant or overwrite\n  -- its working catalog. The row is already locked above.\n  if v_app.pilot_partner_draft_id is not null\n     and (v_merchant.status is distinct from 'pending'\n       or v_merchant.online is distinct from false) then\n    raise exception 'PILOT_MERCHANT_NOT_PENDING' using errcode='40001';\n  end if;\n\n"+grant;
const catalog="        updated_at=clock_timestamp();\n\n    if v_draft.delivery_included then";
const newCatalog="        updated_at=clock_timestamp()\n    where catalog_items.active is false\n      and catalog_items.available_stock=0;\n\n    -- ON CONFLICT ... DO UPDATE WHERE may skip a concurrently activated SKU.\n    -- FOUND is false in that case and the entire approval is rolled back.\n    if not found then\n      raise exception 'PILOT_CATALOG_CONFLICT' using errcode='40001';\n    end if;\n\n    if v_draft.delivery_included then";
assert.ok(before.includes(catalog));
const expected=before.replace(grant,newGrant).replace(catalog,newCatalog);
assert.equal(after,expected,'Never rewrite other business logic when patching the approved RPC');
assert.ok(guarded.includes(
  'revoke all on function public.admin_approve_merchant_application(uuid,uuid) from public,anon,authenticated;'));
assert.ok(guarded.includes(
  'grant execute on function public.admin_approve_merchant_application(uuid,uuid) to service_role;'));
assert.ok(after.indexOf('PILOT_MERCHANT_NOT_PENDING')<after.indexOf('insert into public.merchant_members'));
assert.ok(after.indexOf('PILOT_CATALOG_CONFLICT')<after.indexOf('if v_draft.delivery_included then'));
assert.ok(after.includes('for update'),'Application and merchant must be locked before approval');
assert.ok(after.includes("if v_app.status='approved' then"),
  'A previously approved request must remain idempotent');

// Independent model of conditions; no production rows are modified.
const authorize=(draft,merchant,sku)=>!draft || (
  merchant.status==='pending'&&merchant.online===false&&
  (!sku || (sku.active===false&&sku.availableStock===0))
);
assert.equal(authorize(true,{status:'active',online:true},null),false);
assert.equal(authorize(true,{status:'active',online:false},null),false);
assert.equal(authorize(true,{status:'pending',online:true},null),false);
assert.equal(authorize(true,{status:'pending',online:false},{active:true,availableStock:0}),false);
assert.equal(authorize(true,{status:'pending',online:false},{active:false,availableStock:5}),false);
assert.equal(authorize(true,{status:'pending',online:false},{active:false,availableStock:0}),true);
assert.equal(authorize(true,{status:'pending',online:false},null),true);
assert.equal(authorize(false,{status:'active',online:true},{active:true,availableStock:4}),true,
  'Nonpilot approval remains unchanged');
const edge=read('supabase/functions/admin-ops/index.ts');
for(const code of ['PILOT_MERCHANT_NOT_PENDING','PILOT_CATALOG_CONFLICT']){
  assert.ok(edge.includes('message.includes("'+code+'")'),'Admin Edge must explain '+code);
  assert.ok(edge.includes('error:"'+code+'"'),'Admin Edge must return HTTP 409 for '+code);
}
console.log('V1.401: exactly two surgical SQL guards; safe pilot state, conflict-time SKU and service-role ACL.');
