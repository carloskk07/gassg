-- V1.1159 — verificações reais na base isolada, sem alterações permanentes.
begin;
do $test$
declare p jsonb; v_message text;
begin
 if not public.platform_cnpj_valid_v1_1159('11.222.333/0001-81')
   or not public.platform_cnpj_valid_v1_1159('AB12CD34EF5602')
   or public.platform_cnpj_valid_v1_1159('AB12CD34EF5603')
   or public.platform_cnpj_valid_v1_1159('11222333000180')
   or public.platform_cnpj_valid_v1_1159('00000000000000')
 then raise exception 'V1159_CNPJ_FORMAT_OR_DV_FAILED';end if;
 if exists(select 1 from public.platform_operator_transition_v1_1159
   where singleton and (stage<>'not_started' or entity_kind<>'individual'
     or candidate_cnpj is not null or activated_at is not null))
 then raise exception 'V1159_FICTIONAL_COMPANY_CREATED';end if;
 if (select count(*) from public.platform_operator_transition_gates_v1_1159)<>12
 then raise exception 'V1159_GATES_MISSING';end if;
 if has_table_privilege('anon','public.platform_operator_transition_v1_1159','SELECT')
   or has_table_privilege('authenticated','public.platform_operator_transition_v1_1159','SELECT')
   or has_table_privilege('anon','public.platform_operator_transition_gates_v1_1159','SELECT')
   or has_table_privilege('authenticated','public.platform_operator_transition_audit_v1_1159','INSERT')
 then raise exception 'V1159_PRIVATE_INFO_EXPOSED';end if;
 if has_function_privilege('anon',
   'public.platform_operator_transition_stage_v1_1159(uuid,bigint,text,text,text,text,text,text)',
   'EXECUTE')
   or has_function_privilege('authenticated',
   'public.platform_operator_transition_activate_v1_1159(uuid,bigint,text)',
   'EXECUTE')
 then raise exception 'V1159_DIRECT_RPC_BYPASS';end if;
 if has_function_privilege('anon',
   'public.platform_operator_public_identity_v1_1159()','EXECUTE')
   or has_function_privilege('authenticated',
   'public.platform_operator_public_identity_v1_1159()','EXECUTE')
   or not has_function_privilege('service_role',
   'public.platform_operator_public_identity_v1_1159()','EXECUTE')
 then raise exception 'V1159_PUBLIC_DEFINER_ACL_LEAKED';end if;
 p:=public.platform_operator_public_identity_v1_1159();
 if p->>'public' is distinct from 'false'
   or p->>'entityType' is distinct from 'individual'
   or p?'cnpj' or p?'legalName'
 then raise exception 'V1159_PRIVATE_DRAFT_LEAKED';end if;
 begin
   perform public.platform_operator_transition_activate_v1_1159(
     '00000000-0000-4000-8000-000000000000'::uuid,0,'CONFIRMO ATIVACAO PJ');
   raise exception 'V1159_UNAUTHORIZED_ACTIVATION';
 exception when others then
   get stacked diagnostics v_message=message_text;
   if v_message is distinct from 'OPERATOR_TRANSITION_SUPERADMIN_REQUIRED'
   then raise exception 'V1159_UNEXPECTED_SECURITY_RESULT: %',v_message;end if;
 end;
end $test$;
rollback;
