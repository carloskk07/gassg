-- TAMÃO V1.1161: leitura financeira de preparação PF→PJ, sem transferir saldos.
-- Não grava aceites, não altera CNPJ e não substitui comprovantes externos.
create or replace function public.platform_operator_financial_preflight_v1_1161(p_actor uuid)
returns jsonb language plpgsql stable security definer set search_path to 'pg_catalog'
as $fn$
declare
  v_manual bigint;
  v_outgoing_jobs bigint;
  v_reserved bigint;
  v_ads_refunds bigint;
  v_clube_refunds bigint;
  v_agenda_refunds bigint;
  v_merchant_refunds bigint;
  v_total bigint;
begin
  perform public.platform_operator_transition_assert_owner_v1_1159(p_actor);

  select count(*) into v_manual
    from public.network_manual_payout_requests_v1_1034
    where state in ('requested','approved','review');
  -- Estados do executor Pix: qualquer resultado ainda não definitivo bloqueia.
  select count(*) into v_outgoing_jobs
    from public.network_payout_jobs_v1_1033
    where state not in ('paid','rejected','refunded','cancelled');
  select count(*) into v_reserved
    from public.network_fee_payout_reservations_v1_1031
    where state in ('reserved','reversal_review');
  select count(*) into v_ads_refunds
    from public.ads_independent_refund_cases_v1_887
    where status in ('submitted','reviewing');
  select count(*) into v_clube_refunds
    from public.clube_coupon_refund_requests_v1_814
    where status in ('requested','in_review');
  select count(*) into v_agenda_refunds
    from public.agenda_payment_refunds
    where status in ('requested','processing','failed');
  select count(*) into v_merchant_refunds
    from public.merchant_billing_payment_refunds
    where status='review_required';

  v_total:=v_manual+v_outgoing_jobs+v_reserved+v_ads_refunds+
    v_clube_refunds+v_agenda_refunds+v_merchant_refunds;

  return jsonb_build_object(
    'source','platform_operator_financial_preflight_v1_1161',
    'readOnly',true,'moneyMoved',false,'pspChanged',false,
    'scope','known_internal_pending_obligations',
    'checkedAt',clock_timestamp(),
    'blockerCount',v_total,
    'checks',jsonb_build_array(
      jsonb_build_object('key','manual_payout','title','Saques manuais em aberto','count',v_manual),
      jsonb_build_object('key','payout_executor','title','Repasses Pix não concluídos','count',v_outgoing_jobs),
      jsonb_build_object('key','network_reservations','title','Reservas e revisões da Rede','count',v_reserved),
      jsonb_build_object('key','ads_refunds','title','Estornos de anúncios em análise','count',v_ads_refunds),
      jsonb_build_object('key','clube_refunds','title','Solicitações de estorno do Clube','count',v_clube_refunds),
      jsonb_build_object('key','agenda_refunds','title','Estornos da Agenda não concluídos','count',v_agenda_refunds),
      jsonb_build_object('key','merchant_refunds','title','Estornos de revendas em revisão','count',v_merchant_refunds)
    ),
    'externalReconciliationVerified',false,
    'warning','Contagem interna. Conta PJ, PSP, banco e obrigações fiscais exigem prova externa.'
  );
end $fn$;

revoke all on function public.platform_operator_financial_preflight_v1_1161(uuid)
  from public,anon,authenticated;
grant execute on function public.platform_operator_financial_preflight_v1_1161(uuid)
  to service_role;

-- Reforçar o gatilho original também no servidor, preservando interface,
-- revisão anti-concorrência, assinatura e histórico do V1.1159.
create or replace function public.platform_operator_transition_activate_v1_1159(
  p_actor uuid,p_expected_revision bigint,p_confirmation text)
returns jsonb language plpgsql security definer set search_path to 'pg_catalog'
as $fn$
declare v public.platform_operator_transition_v1_1159%rowtype;
  n_all int;n_ok int;v_revision bigint;
begin
  perform public.platform_operator_transition_assert_owner_v1_1159(p_actor);
  if p_confirmation is distinct from 'CONFIRMO ATIVACAO PJ'
  then raise exception 'OPERATOR_TRANSITION_EXPLICIT_APPROVAL_REQUIRED' using errcode='42501';end if;
  select * into strict v from public.platform_operator_transition_v1_1159
    where singleton for update;
  select count(*),count(*) filter(where verified_at is not null)
    into n_all,n_ok from public.platform_operator_transition_gates_v1_1159;
  if v.stage<>'draft' or v.entity_kind<>'individual'
    or v.revision is distinct from p_expected_revision
    or not public.platform_cnpj_valid_v1_1159(v.candidate_cnpj)
    or n_all<>12 or n_ok<>n_all
  then raise exception 'OPERATOR_TRANSITION_READINESS_NOT_VERIFIED' using errcode='42501';end if;
  -- Saques e repasses manuais pendentes não podem perder sua referência
  -- histórica de responsabilidade na virada de identidade.
  if exists(select 1 from public.network_manual_payout_requests_v1_1034
      where state in ('requested','approved','review'))
  then raise exception 'OPERATOR_TRANSITION_MANUAL_PAYOUTS_OPEN' using errcode='42501';end if;
  -- V1.1161: checagem no MESMO transaction boundary, não apenas no browser.
  -- Não confundir 12 comprovações administrativas com quitação financeira.
  if (public.platform_operator_financial_preflight_v1_1161(p_actor)->>'blockerCount')::bigint>0
  then raise exception 'OPERATOR_TRANSITION_FINANCIAL_ITEMS_OPEN'
    using errcode='42501';end if;
  update public.platform_operator_transition_v1_1159
    set stage='active',entity_kind='company',activated_at=clock_timestamp(),
      activated_by=p_actor,revision=revision+1,updated_at=clock_timestamp()
    where singleton returning revision into v_revision;
  insert into public.platform_operator_transition_audit_v1_1159(actor_id,action,revision)
    values(p_actor,'activate',v_revision);
  return jsonb_build_object('source','platform_operator_transition_v1_1159',
    'stage','active','revision',v_revision,'moneyMoved',false,
    'pspChanged',false,'historicalLedgerRewritten',false);
end $fn$;
