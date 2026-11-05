-- Applied after the V1.835 two completed synthetic rides, inside one
-- disposable transaction, before its final ROLLBACK.
SET LOCAL ROLE service_role;
DO $t$
declare i jsonb; again jsonb; id uuid; b jsonb;
begin
 i:=public.mobility_fee_pix_prepare_v1_837('dddddddd-1000-4000-8000-000000000001');
 id:=(i->>'invoiceId')::uuid;
 if i->>'status'<>'prepared' or (i->>'amountCents')::integer<>760
   or id is null then raise exception 'PIX_INITIAL_TOTAL_FAIL';end if;
 again:=public.mobility_fee_pix_prepare_v1_837('dddddddd-1000-4000-8000-000000000001');
 if again->>'invoiceId'<>id::text
 then raise exception 'PIX_DUPLICATE_INVOICE_CREATED';end if;
 if (select count(*) from public.mobility_fee_pix_invoice_lines_v1_837
     where invoice_id=id)<>2
 then raise exception 'PIX_DOUBLE_OR_MISSING_LINE';end if;
 perform set_config('tamao.ci.pix837',id::text,true);
 b:=public.mobility_fee_pix_prepare_v1_837('dddddddd-1000-4000-8000-000000000003');
 if b->>'status'<>'below_minimum' or (b->>'amountCents')::integer<>0
 then raise exception 'PIX_OTHER_ACCOUNT_CONSUMED_DRIVER_FEES';end if;
end $t$;
SAVEPOINT pix837early;
DO $t$
declare id uuid:=current_setting('tamao.ci.pix837')::uuid; b jsonb;
begin
 b:=public.mobility_fee_pix_recover_paid_v1_837(id,
  'dddddddd-1000-4000-8000-000000000001',
  'ord837early','pay837early',760,repeat('a',64));
 if b->>'status'<>'paid' or (b->>'replayed')::boolean
 then raise exception 'PIX_EARLY_RECOVERY_FAIL';end if;
 b:=public.mobility_fee_pix_recover_paid_v1_837(id,
  'dddddddd-1000-4000-8000-000000000001',
  'ord837early','pay837early',760,repeat('a',64));
 if (b->>'replayed')::boolean is distinct from true
 then raise exception 'PIX_EARLY_REPLAY_FAIL';end if;
 b:=public.admin_mobility_fee_review_v1_836('eeeeeeee-1000-4000-8000-000000000101');
 if (b->>'collectedCents')::integer<>760
  or (b->>'outstandingCents')::integer<>0
  or (b->>'paymentVerified')::boolean is distinct from true
 then raise exception 'PIX_EARLY_PAID_LEDGER_FAIL';end if;
end $t$;
ROLLBACK TO SAVEPOINT pix837early;
DO $t$
declare id uuid:=current_setting('tamao.ci.pix837')::uuid; b jsonb;
begin
 b:=public.mobility_fee_pix_commit_v1_837(
  id,'dddddddd-1000-4000-8000-000000000001',
  'ord837pending','pay837pending',repeat('0',60),null,null,
  clock_timestamp()+interval '10 minutes');
 if b->>'status'<>'active' or (b->>'replayed')::boolean
 then raise exception 'PIX_COMMIT_FAILED';end if;
 b:=public.mobility_fee_pix_commit_v1_837(
  id,'dddddddd-1000-4000-8000-000000000001',
  'ord837pending','pay837pending',repeat('0',60),null,null,
  (select expires_at from public.mobility_fee_pix_invoices_v1_837 where id=id));
 if (b->>'replayed')::boolean is distinct from true
 then raise exception 'PIX_COMMIT_REPLAY_FAILED';end if;
 begin
  perform public.mobility_fee_pix_commit_v1_837(
   id,'dddddddd-1000-4000-8000-000000000003',
   'ord837changed','pay837changed',repeat('0',60),null,null,
   clock_timestamp()+interval '5 minutes');
  raise exception 'PIX_OTHER_DRIVER_CAN_COMMIT';
 exception when insufficient_privilege then null;end;
 begin
  update public.mobility_fee_pix_invoice_lines_v1_837
  set fee_cents=1 where invoice_id=id;
  raise exception 'PIX_LINES_MUTABLE';
 exception when insufficient_privilege then null;end;
 b:=public.mobility_fee_pix_apply_proof_v1_837(
   id,'ord837pending','pay837pending',760,'paid',repeat('b',64));
 if b->>'status'<>'paid' then raise exception 'PIX_PAID_NOT_APPLIED';end if;
 b:=public.mobility_fee_pix_apply_proof_v1_837(
   id,'ord837pending','pay837pending',760,'paid',repeat('b',64));
 if (b->>'replayed')::boolean is distinct from true
 then raise exception 'PIX_PAID_NOT_IDEMPOTENT';end if;
 b:=public.admin_mobility_fee_review_v1_836('eeeeeeee-1000-4000-8000-000000000101');
 if (b->>'collectedCents')::integer<>760
  or (b->>'outstandingCents')::integer<>0
  or (b->>'paymentVerified')::boolean is distinct from true
  or (b->>'invalidInvoiceCount')::integer<>0
 then raise exception 'PIX_PAID_ADMIN_RECONCILIATION_FAIL';end if;
 begin
  perform public.mobility_fee_pix_apply_proof_v1_837(
   id,'ord837pending','pay837pending',760,'expired',repeat('c',64));
  raise exception 'PIX_PAID_EXPIRED_ALLOWED';
 exception when unique_violation then null;end;
 b:=public.mobility_fee_pix_apply_proof_v1_837(
   id,'ord837pending','pay837pending',760,'review_required',repeat('d',64));
 if b->>'status'<>'review_required' then
  raise exception 'PIX_REFUND_REVIEW_NOT_RECORDED';end if;
 b:=public.admin_mobility_fee_review_v1_836('eeeeeeee-1000-4000-8000-000000000101');
 if (b->>'collectedCents')::integer<>0
  or (b->>'outstandingCents')::integer<>760
  or (b->>'paymentVerified')::boolean is distinct from false
 then raise exception 'PIX_REFUND_DID_NOT_REMOVE_COLLECTED';end if;
 b:=public.mobility_fee_pix_prepare_v1_837('dddddddd-1000-4000-8000-000000000001');
 if b->>'invoiceId'<>id::text or b->>'status'<>'review_required'
 then raise exception 'PIX_REFUND_ALLOW_DUPLICATE_CHARGE';end if;
end $t$;
SET LOCAL ROLE authenticated;
DO $t$ BEGIN
 if has_function_privilege('authenticated',
   'public.mobility_fee_pix_prepare_v1_837(uuid)','EXECUTE')
 or has_function_privilege('authenticated',
   'public.mobility_fee_pix_recover_paid_v1_837(uuid,uuid,text,text,integer,text)','EXECUTE')
 or has_function_privilege('authenticated',
   'public.mobility_fee_pix_apply_proof_v1_837(uuid,text,text,integer,text,text)','EXECUTE')
 or has_table_privilege('authenticated',
   'public.mobility_fee_pix_invoices_v1_837','SELECT')
 or has_table_privilege('authenticated',
   'public.mobility_fee_pix_invoice_lines_v1_837','SELECT')
 then raise exception 'PIX_BROWSER_CAN_ACCESS_FINANCE_TABLES';end if;
END $t$;
