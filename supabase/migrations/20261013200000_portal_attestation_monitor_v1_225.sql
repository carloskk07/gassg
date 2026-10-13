-- TAMÃO V1.225 — Diagnose a missing, late or failing scheduled OIDC monitor.
-- Read-only. Uses PostgreSQL's clock, expected :53 UTC slot and five-minute
-- propagation grace; never claims that websites became unavailable.
-- Internal pure classifier allows deterministic safe temporal regressions.
create or replace function tamao_internal.classify_portal_attestation_monitor_v1_225(
  p_now timestamptz, p_job_exists boolean, p_job_active boolean,
  p_job_config_valid boolean, p_last_run_at timestamptz,
  p_last_run_status text, p_observation_found boolean,
  p_observation_state text
) returns text language plpgsql stable security invoker
set search_path=pg_catalog
as $classifier$
declare v_expected timestamptz;
begin
  if p_now is null then return 'unverified'; end if;
  if not coalesce(p_job_exists,false) then return 'job_missing'; end if;
  if not coalesce(p_job_active,false) then return 'job_disabled'; end if;
  if not coalesce(p_job_config_valid,false) then return 'job_changed'; end if;
  v_expected:=date_trunc('hour',p_now at time zone 'UTC') at time zone 'UTC'
    +interval '53 minutes';
  -- Before :58 UTC the most recent expected, grace-complete slot is last hour.
  if p_now<v_expected+interval '5 minutes' then
    v_expected:=v_expected-interval '1 hour';
  end if;
  -- The creation time of cron.job is unavailable. Never claim a missed slot
  -- when we cannot establish whether the job existed before that slot.
  if p_last_run_at is null then return 'awaiting_first'; end if;
  if p_last_run_at>p_now+interval '1 minute' then return 'unverified'; end if;
  if p_last_run_at<v_expected-interval '1 minute' then
    if p_last_run_at<v_expected-interval '1 hour 1 minute'
      then return 'interrupted'; end if;
    return 'missed_run';
  end if;
  if p_last_run_status='failed' then return 'run_failed'; end if;
  if p_last_run_status in ('running','starting','sending') then
    if p_now-p_last_run_at>interval '5 minutes'
      then return 'run_stalled'; end if;
    return 'run_processing';
  end if;
  if p_last_run_status<>'succeeded' then return 'unverified'; end if;
  if not coalesce(p_observation_found,false) then return 'missing_observation'; end if;
  if p_observation_state='unknown' then return 'evidence_unverified'; end if;
  if p_observation_state not in ('clear','active') or p_observation_state is null
    then return 'unverified'; end if;
  return 'healthy';
end;
$classifier$;
revoke all on function tamao_internal.classify_portal_attestation_monitor_v1_225(
  timestamptz,boolean,boolean,boolean,timestamptz,text,boolean,text)
  from public,anon,authenticated,service_role;

create or replace function public.admin_portal_attestation_monitor_v1_225(p_actor_user_id uuid)
returns jsonb language plpgsql stable security definer
set search_path=pg_catalog
as $admin$
declare
  v_now timestamptz:=clock_timestamp();
  v_job cron.job%rowtype;
  v_run cron.job_run_details%rowtype;
  v_last_success timestamptz;
  v_observation tamao_internal.portal_attestation_observations_v1_223%rowtype;
  v_expected timestamptz;
  v_next_due timestamptz;
  v_status text;
  v_cause text;
  v_impact text;
  v_action text;
  v_proof text;
  v_severity text:='none';
  v_config boolean:=false;
  v_missing integer:=0;
begin
  if not exists(select 1 from public.platform_admins a
    where a.user_id=p_actor_user_id and a.active
      and a.admin_role in ('superadmin','operations','readonly')) then
    raise exception 'ADMIN_PERMISSION_DENIED' using errcode='42501';
  end if;

  select * into v_job from cron.job
    where jobname='tamao-portal-attestation-history-v1-223' limit 1;
  v_config:=v_job.jobid is not null and
    v_job.username='postgres' and v_job.schedule='53 * * * *'
    and btrim(v_job.command)='select tamao_internal.record_portal_attestation_history_v1_223();';

  v_expected:=date_trunc('hour',v_now at time zone 'UTC') at time zone 'UTC'
    +interval '53 minutes';
  v_next_due:=case when v_now<=v_expected then v_expected
    else v_expected+interval '1 hour' end;
  if v_now<v_expected+interval '5 minutes' then
    v_expected:=v_expected-interval '1 hour';
  end if;
  if v_job.jobid is not null then
    select * into v_run from cron.job_run_details
      where jobid=v_job.jobid
      order by start_time desc,runid desc limit 1;
    select max(start_time) into v_last_success from cron.job_run_details
      where jobid=v_job.jobid and status='succeeded';
  end if;
  select * into v_observation
    from tamao_internal.portal_attestation_observations_v1_223
    where slot_at=date_trunc('hour',v_expected at time zone 'UTC') at time zone 'UTC';
  v_status:=tamao_internal.classify_portal_attestation_monitor_v1_225(
    v_now,v_job.jobid is not null,v_job.active,v_config,
    v_run.start_time,v_run.status,v_observation.slot_at is not null,
    v_observation.state);
  if v_run.start_time is not null and v_run.start_time<v_expected then
    v_missing:=least(168,greatest(0,floor(extract(epoch from
      (v_expected-v_run.start_time)+interval '30 seconds')/3600)::integer));
  end if;
  v_cause:=case v_status
    when 'healthy' then 'Última janela horária com execução e observação OIDC comprovadas.'
    when 'job_missing' then 'O agendamento PostgreSQL não foi localizado.'
    when 'job_disabled' then 'O agendamento está desativado.'
    when 'job_changed' then 'A configuração do agendamento diverge da versão oficial.'
    when 'awaiting_first' then 'Não há registro nativo de execução automática.'
    when 'missed_run' then 'A última janela esperada passou sem execução comprovada.'
    when 'interrupted' then 'Duas ou mais janelas esperadas transcorreram sem execução comprovada.'
    when 'run_failed' then 'O PostgreSQL registrou falha na execução esperada.'
    when 'run_stalled' then 'A execução está em andamento há mais de cinco minutos.'
    when 'run_processing' then 'A execução está em andamento e ainda não terminou.'
    when 'missing_observation' then 'A rotina concluiu, mas a observação da janela não foi localizada.'
    when 'evidence_unverified' then 'A rotina concluiu, mas a fonte de atestação não pôde ser confirmada.'
    else 'O estado do agendador não pôde ser comprovado.'
  end;
  v_impact:=case
    when v_status='healthy' then 'Apenas a última observação foi comprovada; isso não mede a disponibilidade dos sites.'
    when v_status='run_processing' then 'A verificação ainda não terminou; não concluir que houve falha ou queda dos sites.'
    else 'O histórico automático de atestações pode estar incompleto; isso não comprova queda dos sites.'
  end;
  v_action:=case v_status
    when 'healthy' then 'Acompanhar a próxima execução programada; não há reparo indicado nesta consulta.'
    when 'job_missing' then 'Conferir o agendamento cadastrado no Supabase e a migração oficial da V1.223.'
    when 'job_disabled' then 'Solicitar a um operador autorizado que revise por que o agendamento foi desativado.'
    when 'job_changed' then 'Comparar horário, usuário e comando do job com a migração oficial antes de qualquer correção.'
    when 'awaiting_first' then 'Conferir a data de criação do job e aguardar a primeira execução programada; não registrar incidente sem prova.'
    when 'run_failed' then 'Consultar cron.job_run_details no Supabase e investigar a causa técnica antes de executar qualquer correção.'
    when 'run_processing' then 'Acompanhar a execução em andamento e consultar novamente após a janela de segurança.'
    when 'missing_observation' then 'Conferir a tabela privada de observações e o retorno da função de registro.'
    when 'evidence_unverified' then 'Conferir a atestação OIDC e a prontidão dos portais sem alterar permissões.'
    else 'Verificar o histórico oficial do pg_cron e conferir a configuração do monitor com um operador autorizado.'
  end;
  v_proof:='Confirmar no pg_cron uma nova execução automática concluída com sucesso e sua observação OIDC correspondente na mesma janela horária.';
  v_severity:=case v_status
    when 'healthy' then 'none'
    when 'run_processing' then 'info'
    when 'awaiting_first' then 'warning'
    when 'evidence_unverified' then 'warning'
    when 'unverified' then 'warning'
    when 'missing_observation' then 'high'
    when 'missed_run' then 'high'
    when 'interrupted' then 'high'
    when 'job_missing' then 'high'
    when 'job_disabled' then 'high'
    when 'job_changed' then 'high'
    when 'run_failed' then 'high'
    when 'run_stalled' then 'high'
    else 'warning' end;
  return jsonb_build_object(
    'source','postgres_cron_monitor_v1_225','readOnly',true,
    'noPersonalData',true,'noOutageClaim',true,
    'status',v_status,'severity',v_severity,
    'checkedAt',v_now,
    'expectedSlotAt',v_expected,
    'graceUntil',v_expected+interval '5 minutes',
    'nextDueAt',v_next_due,
    'lastRunAt',v_run.start_time,
    'lastRunStatus',v_run.status,
    'lastSuccessAt',v_last_success,
    'missingSlots',v_missing,
    'cause',v_cause,'impact',v_impact,'action',v_action,
    'recoveryCriteria',v_proof,
    'automaticRemediation',false,
    'scope','postgres_oidc_monitor_not_portal_uptime');
end;
$admin$;
revoke all on function public.admin_portal_attestation_monitor_v1_225(uuid)
  from public,anon,authenticated;
grant execute on function public.admin_portal_attestation_monitor_v1_225(uuid)
  to service_role;
