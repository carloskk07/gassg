import assert from 'node:assert/strict';
// Only called inside the existing isolated, uncommitted canonical fixtures.
// Synthetic report evidence proves software invariants, never bank settlement.
export async function platformNetSqlProof({sql,json,quote},kind,id){
 const source=await json(`SELECT row_to_json(s) FROM public.platform_receipt_net_sources() s WHERE kind=${quote(kind)} AND resource_id=${quote(id)}::uuid;`);
 assert(source);assert.equal(source.reversed,false);
 await sql('UPDATE public.clube_coupon_net_auto_config_v1_931 SET enabled=true WHERE id;');
 const actor=await json("SELECT to_json(user_id) FROM public.platform_admins WHERE active AND admin_role='superadmin' LIMIT 1;");
 const proof={externalReference:source.external_reference,grossCents:source.gross_cents,
  netCents:source.gross_cents-1,sellerId:'955002',providerOrderId:source.provider_order_id,
  providerPaymentId:kind==='advertising'?source.provider_payment_id:'838838838',
  releaseAt:new Date(Date.now()-1000).toISOString(),reportSha256:'a'.repeat(64),
  evidenceReference:'mp-release:synthetic-isolated-only.csv:'+(kind==='advertising'?source.provider_payment_id:'838838838')};
 const call=(status,evidence)=>`public.platform_receipt_net_record(${quote(kind)},${quote(id)}::uuid,${quote(status)},'ISOLATED_ONLY',${evidence===null?'null':quote(JSON.stringify(evidence))+'::jsonb'})`;
 const rejects=async(expression,reason)=>sql(`DO $deny$ BEGIN BEGIN PERFORM ${expression};
  RAISE EXCEPTION 'NET_PROOF_MUST_REJECT'; EXCEPTION WHEN OTHERS THEN
  IF SQLERRM='NET_PROOF_MUST_REJECT' OR SQLERRM NOT LIKE ${quote(reason+'%')} THEN RAISE;END IF;
 END;END $deny$;`);
 await rejects(call('net_verified',{...proof,grossCents:proof.grossCents+1}),'PLATFORM_NET_SOURCE_BINDING_INVALID');
 await rejects(call('net_verified',{...proof,netCents:0}),'PLATFORM_NET_VALUES_INVALID');
 let recorded=await json('SELECT '+call('net_verified',proof)+';');
 assert.equal(recorded.status,'net_verified');assert.equal(recorded.moneyMoved,false);assert.equal(recorded.entitlementsChanged,false);
 recorded=await json('SELECT '+call('net_verified',proof)+';');assert.equal(recorded.status,'net_verified');
 const count=await json(`SELECT to_json(count(*)) FROM public.platform_receipt_net_audit WHERE kind=${quote(kind)} AND resource_id=${quote(id)}::uuid;`);
 assert.equal(count,1,'repeated report must not create a second release');
 await sql(`DO $immutable$ BEGIN BEGIN UPDATE public.platform_receipt_net_audit SET net_cents=net_cents+1
  WHERE kind=${quote(kind)} AND resource_id=${quote(id)}::uuid;
  RAISE EXCEPTION 'NET_AUDIT_WAS_MUTABLE';EXCEPTION WHEN SQLSTATE '42501' THEN
  IF SQLERRM<>'PLATFORM_NET_EVIDENCE_IMMUTABLE' THEN RAISE;END IF;END;END $immutable$;`);
 recorded=await json('SELECT '+call('net_verified',{...proof,netCents:proof.netCents-1})+';');
 assert.equal(recorded.status,'requires_review','conflicting fresh report must preserve original and enter review');
 let view=await json(`SELECT public.admin_platform_receipt_net_summary(${quote(actor)}::uuid);`);
 assert.equal(view.kindTotals[kind].verifiedCount,0);assert.equal(view.kindTotals[kind].pendingCount,1);
 await json('SELECT '+call('net_verified',proof)+';');
 view=await json(`SELECT public.admin_platform_receipt_net_summary(${quote(actor)}::uuid);`);
 assert.equal(view.kindTotals[kind].verifiedNetCents,proof.netCents);
 assert.equal(view.kindTotals[kind].verifiedCount,1);assert.equal(view.merchantFundsIncluded,false);
 await rejects("public.admin_platform_receipt_net_summary(gen_random_uuid())",'ADMIN_PERMISSION_DENIED');
 // Server-only privileges, including internal source and pending selectors.
 await sql(`DO $acl$ DECLARE p record; BEGIN
  IF has_table_privilege('anon','public.platform_receipt_net_audit','SELECT')
   OR has_table_privilege('authenticated','public.platform_receipt_net_observations','INSERT')
   OR has_table_privilege('service_role','public.platform_receipt_net_audit','UPDATE')
  THEN RAISE EXCEPTION 'NET_TABLE_PRIVILEGE_LEAK';END IF;
  FOR p IN SELECT oid FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN
   ('platform_receipt_net_sources','platform_receipt_net_pending','platform_receipt_net_record','admin_platform_receipt_net_summary')
  LOOP IF has_function_privilege('anon',p.oid,'EXECUTE') OR has_function_privilege('authenticated',p.oid,'EXECUTE')
   THEN RAISE EXCEPTION 'NET_RPC_PRIVILEGE_LEAK';END IF;END LOOP;
 END $acl$;`);
 if(kind==='advertising'){
  // Same canonical provider-fact engine used by the signed webhook.
  await sql(`SELECT public.ads_independent_payment_fact_v1_886(repeat('9',64),${quote(source.external_reference)},
   ${quote(source.provider_payment_id)},'955002',${source.gross_cents},'BRL','refunded','refunded',true);`);
  recorded=await json('SELECT '+call('net_verified',proof)+';');assert.equal(recorded.status,'reversed');
  view=await json(`SELECT public.admin_platform_receipt_net_summary(${quote(actor)}::uuid);`);
  assert.equal(view.kindTotals.advertising.verifiedNetCents,0);assert.equal(view.kindTotals.advertising.reversedCount,1);
  assert.equal(view.rows.find(r=>r.resourceId===id).netCents,proof.netCents,'original immutable release stays in history after reversal');
 }
 console.log('PASS: actual '+kind+' NET projection SQL, immutable proof, conflict/retry, role/RLS and scoped full-database totals (synthetic ROLLBACK).');
}
