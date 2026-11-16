\set ON_ERROR_STOP on
-- Isolated PostgreSQL + ROLLBACK, no money, no production account changes.
begin;
set local statement_timeout='60s';
do $test$
declare
 v_a uuid:=gen_random_uuid(); v_b uuid:=gen_random_uuid();
 v_src uuid:=gen_random_uuid();v_direct uuid:=gen_random_uuid();
 v_result jsonb;v_page jsonb;v_denied boolean:=false;
begin
 insert into auth.users(id,aud,role,is_anonymous,email,email_confirmed_at)
 values (v_a,'authenticated','authenticated',false,'statement-a@example.invalid',clock_timestamp()),
        (v_b,'authenticated','authenticated',false,'statement-b@example.invalid',clock_timestamp());
 if has_function_privilege('anon',
   'public.network_member_benefit_statement_v1_1045(uuid,text,integer,integer)','EXECUTE')
   or has_function_privilege('authenticated',
   'public.network_member_benefit_statement_v1_1045(uuid,text,integer,integer)','EXECUTE')
 then raise exception 'STATEMENT_PRIVILEGE_LEAK';end if;

 -- Existing source of cash benefit, never a synthetic payout from the RPC.
 insert into public.wallet_entries(user_id,bucket,entry_type,amount_cents,idempotency_key)
 values (v_a,'cashback','cashback_seed',100,'CI-STATEMENT-WELCOME-1045-A'),
        (v_b,'cashback','cashback_seed',999,'CI-STATEMENT-WELCOME-1045-B');
 insert into public.network_fee_package_sources_v1_1030
 (kind,source_id,buyer_user_id,gross_cents,net_cents,fee_credit_cents,
  pool_microcents,attributed_at,closed_at,receipt_reference)
 values ('mobility_prepaid_fee',v_src,v_b,200,190,200,19000000,
   clock_timestamp()-interval '2 days',clock_timestamp()-interval '1 day',
   'CI-MICROCENTS-FAKE-1045');
 insert into public.network_fee_package_awards_v1_1030
 (kind,source_id,user_id,equal_microcents,inviter_microcents)
 values ('mobility_prepaid_fee',v_src,v_a,500000,0);
 insert into public.network_direct_module_awards_v1_1044
 (module,source_id,referred_user_id,inviter_user_id,net_cents,
  bonus_cents,proof_reference,qualified_at,matured_at,status)
 values ('mobility',v_direct,v_b,v_a,1000,50,'CI-NET-FAKE-DIRECT-1045',
  clock_timestamp()-interval '9 days',clock_timestamp()-interval '2 days','validated');

 v_result:=public.network_member_benefit_statement_v1_1045(v_a,'all',1,12);
 if v_result->>'source'<>'network_member_statement_v1_1045' or
    v_result->>'readOnly'<>'true' or v_result->>'moneyMoved'<>'false'
    or jsonb_array_length(v_result->'items')<>3
 then raise exception 'STATEMENT_READ_ONLY_OR_THREE_SOURCES_MISSING:%',v_result;end if;
 if not exists(select 1 from jsonb_array_elements(v_result->'items') e
   where e->>'money_type'='wallet' and e->>'title'='Crédito de boas-vindas'
     and (e->>'amountCents')::integer=100)
 then raise exception 'STATEMENT_CASHBACK_PROVENANCE_MISSING';end if;
 if not exists(select 1 from jsonb_array_elements(v_result->'items') e
   where e->>'money_type'='network' and e->>'title'='Sua participação no fundo'
     and (e->>'amountCents')::integer=0 and
     (e->>'amountMicrocents')::bigint=500000)
 then raise exception 'STATEMENT_SUBCENT_MUST_NOT_ROUND_TO_ONE_CENT';end if;
 if not exists(select 1 from jsonb_array_elements(v_result->'items') e
   where e->>'title'='Indicação de motorista' and
     (e->>'amountCents')::integer=50 and e->>'status'='validated')
 then raise exception 'STATEMENT_DIRECT_BONUS_OR_STATUS_MISSING';end if;
 if exists(select 1 from jsonb_array_elements(v_result->'items') e
   where (e->>'amountCents')::integer=999)
 then raise exception 'STATEMENT_CROSS_ACCOUNT_LEAK';end if;

 v_page:=public.network_member_benefit_statement_v1_1045(v_a,'all',1,1);
 if v_page->>'hasMore'<>'true' or jsonb_array_length(v_page->'items')<>1
 then raise exception 'STATEMENT_PAGINATION_1_FAILED:%',v_page;end if;
 v_page:=public.network_member_benefit_statement_v1_1045(v_a,'all',3,1);
 if v_page->>'hasMore'<>'false' or jsonb_array_length(v_page->'items')<>1
 then raise exception 'STATEMENT_PAGINATION_LAST_FAILED:%',v_page;end if;
 v_result:=public.network_member_benefit_statement_v1_1045(v_a,'cashback');
 if jsonb_array_length(v_result->'items')<>1 or
    v_result->'items'->0->>'category'<>'cashback'
 then raise exception 'STATEMENT_CATEGORY_CASHBACK_FAILED:%',v_result;end if;
 v_result:=public.network_member_benefit_statement_v1_1045(v_a,'rede');
 if jsonb_array_length(v_result->'items')<>2
 then raise exception 'STATEMENT_CATEGORY_REDE_FAILED:%',v_result;end if;
 v_result:=public.network_member_benefit_statement_v1_1045(v_a,'clube');
 if jsonb_array_length(v_result->'items')<>0
 then raise exception 'STATEMENT_EMPTY_CATEGORY_FAILED:%',v_result;end if;
 v_denied:=false;
 begin perform public.network_member_benefit_statement_v1_1045(v_a,'bogus',1,12);
 exception when sqlstate '22023' then v_denied:=true;end;
 if not v_denied then raise exception 'STATEMENT_FILTER_ACCEPTED_UNKNOWN_CATEGORY';end if;
 v_denied:=false;
 begin perform public.network_member_benefit_statement_v1_1045(v_a,'all',0,12);
 exception when sqlstate '22023' then v_denied:=true;end;
 if not v_denied then raise exception 'STATEMENT_INVALID_PAGE_ACCEPTED';end if;

 if exists(select 1 from public.network_manual_payout_requests_v1_1034 where user_id=v_a)
 then raise exception 'STATEMENT_MUST_NOT_CREATE_PAYOUT';end if;
end $test$;
rollback;
select 'V1.1045 PASS — 3 origins, account isolation, subcent, pagination, category, ACL, no payout' as proof;
