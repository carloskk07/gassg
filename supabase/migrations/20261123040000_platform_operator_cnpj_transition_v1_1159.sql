-- TAMÃO V1.1159 — preparação reversível para troca futura PF -> PJ.
-- Nenhum CNPJ é inventado. A migração começa inativa e não muda PSP, Pix,
-- clientes, pedidos, repasses, contratos ou saldos históricos.
create or replace function public.platform_cnpj_valid_v1_1159(p_raw text)
returns boolean language plpgsql immutable
set search_path to 'pg_catalog'
as $fn$
declare
  c text:=regexp_replace(upper(coalesce(p_raw,'')),'[^0-9A-Z]','','g');
  w1 int[]:=array[5,4,3,2,9,8,7,6,5,4,3,2];
  w2 int[]:=array[6,5,4,3,2,9,8,7,6,5,4,3,2];
  s int:=0;
  dv1 int;
  dv2 int;
  i int;
begin
  -- Desde julho/2026 os 12 primeiros caracteres podem ser alfanuméricos;
  -- os dois verificadores finais permanecem numéricos.
  if c !~ '^[0-9A-Z]{12}[0-9]{2}$'
    or substring(c,1,12)=repeat(substring(c,1,1),12)
  then return false; end if;
  for i in 1..12 loop
    s:=s+(ascii(substring(c,i,1))-48)*w1[i];
  end loop;
  dv1:=case when s%11<2 then 0 else 11-s%11 end;
  if substring(c,13,1)<>dv1::text then return false; end if;
  s:=0;
  for i in 1..13 loop
    s:=s+(ascii(substring(c,i,1))-48)*w2[i];
  end loop;
  dv2:=case when s%11<2 then 0 else 11-s%11 end;
  return substring(c,14,1)=dv2::text;
end $fn$;

create table if not exists public.platform_operator_transition_v1_1159 (
  singleton boolean primary key default true check(singleton),
  stage text not null default 'not_started'
    check(stage in ('not_started','draft','active')),
  entity_kind text not null default 'individual'
    check(entity_kind in ('individual','company')),
  revision bigint not null default 0 check(revision>=0),
  candidate_cnpj text check(candidate_cnpj is null or
    candidate_cnpj ~ '^[A-Z0-9]{12}[0-9]{2}$'),
  legal_name text check(legal_name is null or length(legal_name) between 3 and 160),
  trade_name text check(trade_name is null or length(trade_name) between 2 and 120),
  public_address text check(public_address is null or length(public_address) between 10 and 240),
  contact_email text check(contact_email is null or length(contact_email) between 6 and 180),
  prepared_by uuid references auth.users(id),
  prepared_at timestamptz,
  activated_by uuid references auth.users(id),
  activated_at timestamptz,
  updated_at timestamptz not null default clock_timestamp(),
  constraint operator_transition_activation_shape_v1_1159 check (
    (stage='active' and entity_kind='company' and
      candidate_cnpj is not null and activated_at is not null)
    or (stage<>'active' and entity_kind='individual' and activated_at is null))
);
insert into public.platform_operator_transition_v1_1159(singleton)
values(true) on conflict(singleton) do nothing;
alter table public.platform_operator_transition_v1_1159 enable row level security;
revoke all on public.platform_operator_transition_v1_1159 from public,anon,authenticated;
grant select,update on public.platform_operator_transition_v1_1159 to service_role;

create table if not exists public.platform_operator_transition_gates_v1_1159 (
  gate_key text primary key,
  title text not null,
  sort_order integer not null unique,
  verified_at timestamptz,
  verified_by uuid references auth.users(id),
  evidence_reference text,
  constraint operator_gate_evidence_v1_1159 check (
    (verified_at is null and verified_by is null and evidence_reference is null)
    or (verified_at is not null and verified_by is not null
      and length(evidence_reference) between 16 and 200))
);
insert into public.platform_operator_transition_gates_v1_1159(gate_key,title,sort_order) values
 ('cnpj_registry','CNPJ ativo e razão social conferidos na Receita Federal',1),
 ('tax_accountant','Contador, CNAE, natureza jurídica e regime tributário conferidos',2),
 ('fiscal_invoicing','Inscrições e emissão fiscal de serviços homologadas',3),
 ('provider_kyc','Conta Mercado Pago PJ e titularidade verificadas',4),
 ('provider_credentials','Credenciais de produção, cobrança e reembolsos conferidas',5),
 ('webhook_reconciliation','Webhooks e conciliação financeira homologados na PJ',6),
 ('bank_pix','Conta de recebimento e titularidade de Pix PJ conferidas',7),
 ('pending_settlements','Liquidações anteriores e créditos a receber conciliados',8),
 ('refund_chargebacks','Estornos, contestações e obrigações antigas preservados',9),
 ('network_liabilities','Saldos de rede, cupons, cashback e saques antigos conciliados',10),
 ('public_disclosures','Endereço, identificação pública, suporte e política atualizados',11),
 ('contract_cutover','Contratos, termos, privacidade e plano de virada/retorno aprovados',12)
on conflict(gate_key) do nothing;
alter table public.platform_operator_transition_gates_v1_1159 enable row level security;
revoke all on public.platform_operator_transition_gates_v1_1159 from public,anon,authenticated;
grant select,update on public.platform_operator_transition_gates_v1_1159 to service_role;

create table if not exists public.platform_operator_transition_audit_v1_1159 (
  id bigint generated always as identity primary key,
  actor_id uuid not null references auth.users(id),
  action text not null check(action in ('stage','verify','reopen','activate')),
  revision bigint not null,
  gate_key text,
  evidence_reference text,
  recorded_at timestamptz not null default clock_timestamp()
);
alter table public.platform_operator_transition_audit_v1_1159 enable row level security;
revoke all on public.platform_operator_transition_audit_v1_1159 from public,anon,authenticated;
grant select,insert on public.platform_operator_transition_audit_v1_1159 to service_role;
grant usage on sequence public.platform_operator_transition_audit_v1_1159_id_seq to service_role;

create or replace function public.platform_operator_transition_assert_owner_v1_1159(p_actor uuid)
returns void language plpgsql security definer set search_path to 'pg_catalog'
as $fn$
begin
  if p_actor is null or not exists(select 1 from public.platform_admins a
    where a.user_id=p_actor and a.active and a.admin_role='superadmin')
  then raise exception 'OPERATOR_TRANSITION_SUPERADMIN_REQUIRED' using errcode='42501';end if;
end $fn$;

create or replace function public.platform_operator_transition_read_v1_1159(p_actor uuid)
returns jsonb language plpgsql stable security definer set search_path to 'pg_catalog'
as $fn$
declare v public.platform_operator_transition_v1_1159%rowtype;
  n_all integer; n_verified integer;
  gates jsonb;
begin
  perform public.platform_operator_transition_assert_owner_v1_1159(p_actor);
  select * into strict v from public.platform_operator_transition_v1_1159 where singleton;
  select count(*),count(*) filter(where verified_at is not null),
    coalesce(jsonb_agg(jsonb_build_object(
      'key',gate_key,'title',title,'verified',verified_at is not null,
      'checkedAt',verified_at,'evidenceReference',evidence_reference
    ) order by sort_order),'[]'::jsonb)
  into n_all,n_verified,gates
  from public.platform_operator_transition_gates_v1_1159;
  return jsonb_build_object('source','platform_operator_transition_v1_1159',
    'readOnly',true,'moneyMoved',false,'pspChanged',false,
    'currentEntityKind',v.entity_kind,'stage',v.stage,'revision',v.revision,
    'candidate',case when v.candidate_cnpj is null then null else jsonb_build_object(
      'cnpj',v.candidate_cnpj,'legalName',v.legal_name,
      'tradeName',v.trade_name,'publicAddress',v.public_address,
      'contactEmail',v.contact_email) end,
    'verifiedGates',n_verified,'totalGates',n_all,'gates',gates,
    'readyToActivate',v.stage='draft' and n_all=12 and n_verified=n_all
      and public.platform_cnpj_valid_v1_1159(v.candidate_cnpj),
    'activatedAt',v.activated_at);
end $fn$;

create or replace function public.platform_operator_transition_stage_v1_1159(
  p_actor uuid,p_expected_revision bigint,p_cnpj text,
  p_legal_name text,p_trade_name text,p_public_address text,
  p_contact_email text,p_confirmation text)
returns jsonb language plpgsql security definer set search_path to 'pg_catalog'
as $fn$
declare v_cnpj text:=regexp_replace(upper(coalesce(p_cnpj,'')),'[^0-9A-Z]','','g');
  v_legal text:=btrim(coalesce(p_legal_name,''));
  v_trade text:=btrim(coalesce(p_trade_name,''));
  v_address text:=btrim(coalesce(p_public_address,''));
  v_email text:=lower(btrim(coalesce(p_contact_email,'')));
  v_revision bigint;
begin
  perform public.platform_operator_transition_assert_owner_v1_1159(p_actor);
  if p_confirmation is distinct from 'PREPARAR DADOS PJ'
    or not public.platform_cnpj_valid_v1_1159(v_cnpj)
    or length(v_legal) not between 3 and 160
    or length(v_trade) not between 2 and 120
    or length(v_address) not between 10 and 240
    or length(v_email) not between 6 and 180
    or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or (v_legal||v_trade||v_address) ~ '[<>]'
  then raise exception 'OPERATOR_TRANSITION_DOCUMENTS_INVALID' using errcode='22023';end if;
  update public.platform_operator_transition_v1_1159
  set stage='draft',candidate_cnpj=v_cnpj,legal_name=v_legal,
    trade_name=v_trade,public_address=v_address,contact_email=v_email,
    revision=revision+1,updated_at=clock_timestamp(),
    prepared_at=clock_timestamp(),prepared_by=p_actor
  where singleton and entity_kind='individual' and stage<>'active'
    and revision=p_expected_revision
  returning revision into v_revision;
  if not found then raise exception 'OPERATOR_TRANSITION_STALE_OR_ACTIVE' using errcode='40001';end if;
  -- Trocar os dados invalida TODAS as provas anteriores: não há "aceite"
  -- herdado de outra empresa ou de uma revisão do cadastro.
  update public.platform_operator_transition_gates_v1_1159
    set verified_at=null,verified_by=null,evidence_reference=null;
  insert into public.platform_operator_transition_audit_v1_1159(actor_id,action,revision)
    values(p_actor,'stage',v_revision);
  return jsonb_build_object('source','platform_operator_transition_v1_1159',
    'stage','draft','revision',v_revision,'moneyMoved',false,'pspChanged',false);
end $fn$;

create or replace function public.platform_operator_transition_gate_v1_1159(
  p_actor uuid,p_expected_revision bigint,p_gate_key text,
  p_verified boolean,p_evidence_reference text,p_confirmation text)
returns jsonb language plpgsql security definer set search_path to 'pg_catalog'
as $fn$
declare v_revision bigint;v_ref text:=nullif(btrim(coalesce(p_evidence_reference,'')),'');
begin
  perform public.platform_operator_transition_assert_owner_v1_1159(p_actor);
  if p_verified is null or p_verified and
      (p_confirmation is distinct from 'EVIDENCIA EXTERNA CONFERIDA'
       or length(v_ref) not between 16 and 200 or v_ref ~ '[<>]')
  then raise exception 'OPERATOR_TRANSITION_REAL_EVIDENCE_REQUIRED' using errcode='22023';end if;
  update public.platform_operator_transition_v1_1159
  set revision=revision+1,updated_at=clock_timestamp()
  where singleton and stage='draft' and entity_kind='individual'
    and revision=p_expected_revision
  returning revision into v_revision;
  if not found then raise exception 'OPERATOR_TRANSITION_STALE_OR_NOT_DRAFT' using errcode='40001';end if;
  update public.platform_operator_transition_gates_v1_1159
    set verified_at=case when p_verified then clock_timestamp() else null end,
      verified_by=case when p_verified then p_actor else null end,
      evidence_reference=case when p_verified then v_ref else null end
    where gate_key=p_gate_key;
  if not found then raise exception 'OPERATOR_TRANSITION_UNKNOWN_GATE' using errcode='22023';end if;
  insert into public.platform_operator_transition_audit_v1_1159
    (actor_id,action,revision,gate_key,evidence_reference)
  values(p_actor,case when p_verified then 'verify' else 'reopen' end,
    v_revision,p_gate_key,case when p_verified then v_ref else null end);
  return jsonb_build_object('source','platform_operator_transition_v1_1159',
    'revision',v_revision,'gateKey',p_gate_key,'verified',p_verified,
    'moneyMoved',false,'pspChanged',false);
end $fn$;

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

-- Somente a identidade PJ EFETIVAMENTE ATIVADA é divulgada.
-- Nada do cadastro preparatório, CPF pessoal, documentos, provas ou chaves PSP
-- chega a visitantes (tampouco aos usuários autenticados comuns).
create or replace function public.platform_operator_public_identity_v1_1159()
returns jsonb language sql stable security definer set search_path to 'pg_catalog'
as $fn$
  select case when p.stage='active' and p.entity_kind='company'
    then jsonb_build_object('source','platform_operator_public_identity_v1_1159',
      'entityType','company','public',true,'cnpj',p.candidate_cnpj,
      'legalName',p.legal_name,'tradeName',p.trade_name,
      'publicAddress',p.public_address,'contactEmail',p.contact_email,
      'effectiveAt',p.activated_at)
    else jsonb_build_object('source','platform_operator_public_identity_v1_1159',
      'entityType','individual','public',false) end
  from public.platform_operator_transition_v1_1159 p where p.singleton
$fn$;

revoke all on function public.platform_cnpj_valid_v1_1159(text) from public,anon,authenticated;
revoke all on function public.platform_operator_transition_assert_owner_v1_1159(uuid) from public,anon,authenticated;
revoke all on function public.platform_operator_transition_read_v1_1159(uuid) from public,anon,authenticated;
revoke all on function public.platform_operator_transition_stage_v1_1159(uuid,bigint,text,text,text,text,text,text) from public,anon,authenticated;
revoke all on function public.platform_operator_transition_gate_v1_1159(uuid,bigint,text,boolean,text,text) from public,anon,authenticated;
revoke all on function public.platform_operator_transition_activate_v1_1159(uuid,bigint,text) from public,anon,authenticated;
revoke all on function public.platform_operator_public_identity_v1_1159() from public,anon,authenticated;
grant execute on function public.platform_cnpj_valid_v1_1159(text) to service_role;
grant execute on function public.platform_operator_transition_assert_owner_v1_1159(uuid) to service_role;
grant execute on function public.platform_operator_transition_read_v1_1159(uuid) to service_role;
grant execute on function public.platform_operator_transition_stage_v1_1159(uuid,bigint,text,text,text,text,text,text) to service_role;
grant execute on function public.platform_operator_transition_gate_v1_1159(uuid,bigint,text,boolean,text,text) to service_role;
grant execute on function public.platform_operator_transition_activate_v1_1159(uuid,bigint,text) to service_role;
grant execute on function public.platform_operator_public_identity_v1_1159() to anon,authenticated,service_role;
