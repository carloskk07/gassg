-- #838 — revisão financeira explícita e abertura dos três planos consumíveis.
-- Só aplicar em produção DEPOIS que Edge Pix/webhook e três portais atualizados.
do $$
declare
 v_posture jsonb:=public.tamao_launch_acl_posture_v1();
 v_old text:='9853381e58a69957edffa0dd33f9a31f';
 v_new text:='fb112503c524fa9e58da1d1b7c035c25';
 v_function text;
 v_expected integer;
begin
 if v_posture->>'tableDigest'<>'67838fe06fa43d7692e12d8e11a3de91'
  or (v_posture->>'tableCount')::integer<>7
  or (v_posture->>'rpcCount')::integer<>36
  or v_posture->>'rpcDigest'<>v_new
 then raise exception 'MOBILITY_PREPAID_ACL_UNREVIEWED';end if;
 if has_table_privilege('anon','public.mobility_fee_prepaid_lots_v1_838','SELECT')
   or has_table_privilege('authenticated','public.mobility_fee_prepaid_lots_v1_838','SELECT')
   or has_table_privilege('authenticated','public.mobility_fee_prepaid_uses_v1_838','SELECT')
   or has_function_privilege('authenticated',
      'public.mobility_fee_pix_prepare_credit_v1_838(uuid,text)','EXECUTE')
   or has_function_privilege('anon',
      'public.mobility_fee_pix_prepare_credit_v1_838(uuid,text)','EXECUTE')
   or not has_function_privilege('service_role',
      'public.mobility_fee_pix_prepare_credit_v1_838(uuid,text)','EXECUTE')
   or not has_function_privilege('authenticated',
      'public.mobility_billing_catalog_v1_826()','EXECUTE')
 then raise exception 'MOBILITY_PREPAID_PRIVILEGES_CHANGED';end if;
 if (select count(*) from public.mobility_billing_plans_v1_826 p
   where (p.plan_key='essential' and p.purchase_amount_cents=990 and p.platform_fee_bps=600)
      or (p.plan_key='popular' and p.purchase_amount_cents=2490 and p.platform_fee_bps=550)
      or (p.plan_key='professional' and p.purchase_amount_cents=4990 and p.platform_fee_bps=500)
 )<>3 then raise exception 'MOBILITY_PREPAID_PRICE_POLICY_CHANGED';end if;
 if (select count(*) from pg_trigger where tgrelid='public.mobility_fee_pix_invoices_v1_837'::regclass
  and tgname='mobility_prepaid_fund_v1_838_trg' and tgenabled='O')<>1
  or (select count(*) from pg_trigger where tgrelid='public.mobility_requests'::regclass
   and tgname='mobility_zy_prepaid_settle_v1_838_trg' and tgenabled='O')<>1
 then raise exception 'MOBILITY_PREPAID_TRIGGERS_NOT_ACTIVE';end if;
 if position('MOBILITY_PREPAID_PROVIDER_PROOF_MISSING' in
    pg_get_functiondef('public.mobility_fee_prepaid_fund_v1_838()'::regprocedure))=0
  or position('mobility_fee_prepaid_reserve_v1_838' in
    pg_get_functiondef('public.mobility_fare_terms_on_accept_v1_832()'::regprocedure))=0
  or position('MOBILITY_PREPAID_FEE_NOT_SETTLED' in
    pg_get_functiondef('public.mobility_fee_accrual_on_completed_v1_835()'::regprocedure))=0
 then raise exception 'MOBILITY_PREPAID_CONSISTENCY_MISSING';end if;
 v_function:=pg_get_functiondef('public.platform_launch_readiness()'::regprocedure);
 if position(v_old in v_function)=0 or position(v_new in v_function)>0
  or length(v_function)-length(replace(v_function,v_old,''))<>length(v_old)
 then raise exception 'MOBILITY_PREPAID_REVIEW_BASELINE_CHANGED';end if;
 execute replace(v_function,v_old,v_new);
 update public.mobility_billing_plans_v1_826
 set purchase_enabled=true
 where plan_key in ('essential','popular','professional')
   and billing_mode='prepaid';
 get diagnostics v_expected=row_count;
 if v_expected<>3 then raise exception 'MOBILITY_PREPAID_CATALOG_NOT_ENABLED';end if;
end $$;
