-- TAMÃO #837. Cobrança Pix opcional de taxas de motoristas — dinheiro
-- da corrida segue DIRETO ao motorista. Não reutilizar recebíveis de revendas.
-- O webhook só chama a baixa após HMAC + consulta independente ao Mercado Pago.
create table public.mobility_fee_pix_invoices_v1_837 (
 id uuid primary key default gen_random_uuid(),
 driver_id uuid not null references auth.users(id) on delete restrict,
 external_reference text not null unique
    check(external_reference ~ '^mobility-fee:[0-9a-f-]{36}$'),
 amount_cents integer not null check(amount_cents between 100 and 1000000),
 currency text not null default 'BRL' check(currency='BRL'),
 status text not null default 'prepared'
   check(status in ('prepared','active','paid','expired','review_required')),
 provider text not null default 'mercadopago' check(provider='mercadopago'),
 provider_order_id text unique,
 provider_payment_id text unique,
 pix_br_code text,
 pix_qr_data_uri text,
 payment_link_url text,
 expires_at timestamptz,
 paid_at timestamptz,
 review_at timestamptz,
 provider_evidence_hash text,
 last_provider_state text,
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 check((status='prepared' and provider_order_id is null
     and paid_at is null and expires_at is null)
  or (status<>'prepared' and provider_order_id is not null)),
 check (status<>'paid' or (paid_at is not null
     and provider_evidence_hash ~ '^[0-9a-f]{64}$')),
 check (pix_br_code is null or length(pix_br_code) between 20 and 8192)
);
create unique index mobility_fee_one_unresolved_invoice_v1_837_idx
 on public.mobility_fee_pix_invoices_v1_837(driver_id)
 where status in ('prepared','active','expired','review_required');
create index mobility_fee_invoice_driver_v1_837_idx
 on public.mobility_fee_pix_invoices_v1_837(driver_id,created_at desc);
create table public.mobility_fee_pix_invoice_lines_v1_837 (
 request_id uuid primary key references public.mobility_platform_fee_accruals_v1_835(request_id) on delete restrict,
 invoice_id uuid not null references public.mobility_fee_pix_invoices_v1_837(id) on delete restrict,
 fee_cents integer not null check(fee_cents between 1 and 1000000)
);
create index mobility_fee_invoice_lines_by_invoice_v1_837_idx
 on public.mobility_fee_pix_invoice_lines_v1_837(invoice_id);
-- Membership of a paid/pending invoice is an immutable financial fact:
-- rerouting the same ride to a second invoice is forbidden.
create or replace function public.mobility_fee_pix_line_immutable_v1_837()
returns trigger language plpgsql security definer set search_path=pg_catalog
as $$
begin
 raise exception 'MOBILITY_PIX_INVOICE_LINE_IMMUTABLE' using errcode='42501';
end;
$$;
revoke all on function public.mobility_fee_pix_line_immutable_v1_837()
 from public,anon,authenticated;
create trigger mobility_fee_pix_line_immutable_v1_837_trg
 before update or delete on public.mobility_fee_pix_invoice_lines_v1_837
 for each row execute function public.mobility_fee_pix_line_immutable_v1_837();

create table public.mobility_fee_pix_evidence_v1_837 (
 id uuid primary key default gen_random_uuid(),
 invoice_id uuid not null references public.mobility_fee_pix_invoices_v1_837(id) on delete restrict,
 event_state text not null check(event_state in ('paid','expired','review_required')),
 provider_order_id text not null,
 provider_payment_id text not null,
 amount_cents integer not null check(amount_cents>=100),
 evidence_hash text not null check(evidence_hash ~ '^[0-9a-f]{64}$'),
 verified_at timestamptz not null default clock_timestamp(),
 unique(invoice_id,event_state)
);
create index mobility_fee_pix_evidence_invoice_v1_837_idx
 on public.mobility_fee_pix_evidence_v1_837(invoice_id);
alter table public.mobility_fee_pix_invoices_v1_837 enable row level security;
alter table public.mobility_fee_pix_invoice_lines_v1_837 enable row level security;
alter table public.mobility_fee_pix_evidence_v1_837 enable row level security;
revoke all on public.mobility_fee_pix_invoices_v1_837,
 public.mobility_fee_pix_invoice_lines_v1_837,
 public.mobility_fee_pix_evidence_v1_837 from public,anon,authenticated;

create or replace function public.mobility_fee_pix_evidence_immutable_v1_837()
returns trigger language plpgsql security definer set search_path=pg_catalog
as $$
begin
 raise exception 'MOBILITY_PIX_EVIDENCE_IMMUTABLE' using errcode='42501';
end;
$$;
revoke all on function public.mobility_fee_pix_evidence_immutable_v1_837()
 from public,anon,authenticated;
create trigger mobility_fee_pix_evidence_immutable_v1_837_trg
 before update or delete on public.mobility_fee_pix_evidence_v1_837
 for each row execute function public.mobility_fee_pix_evidence_immutable_v1_837();

-- Serviço só recebe um userId validado no Supabase Auth do JWT.
-- Não aceita valor arbitrário: lê apenas fatos imutáveis da taxa.
create or replace function public.mobility_fee_pix_prepare_v1_837(p_driver uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog
as $$
declare
 v_invoice public.mobility_fee_pix_invoices_v1_837%rowtype;
 v_ids uuid[];
 v_amount bigint:=0;
 v_id uuid:=gen_random_uuid();
 v_rows bigint:=0;
begin
 if p_driver is null or not exists(
   select 1 from auth.users u where u.id=p_driver and u.is_anonymous=false
 ) then raise exception 'MOBILITY_FEE_PAYER_NOT_PERMANENT'
   using errcode='42501';end if;
 perform pg_advisory_xact_lock(
   hashtextextended('mobility-fee-invoice:'||p_driver::text,0));
 select * into v_invoice from public.mobility_fee_pix_invoices_v1_837
 where driver_id=p_driver
   and status in ('prepared','active','expired','review_required')
 for update;
 if found then
   return jsonb_build_object('invoiceId',v_invoice.id,
    'status',v_invoice.status,'amountCents',v_invoice.amount_cents,
    'externalReference',v_invoice.external_reference,
    'createdAt',v_invoice.created_at);
 end if;
 -- Com sum acumulada e teto por fatura, cada lançamento entra em no
 -- máximo UMA cobrança. O saldo abaixo de R$1 acumula sem fatura.
 with unbilled as (
  select a.request_id,a.fee_cents,a.recorded_at
  from public.mobility_platform_fee_accruals_v1_835 a
  where a.driver_id=p_driver and a.fee_cents>0
    and not exists(select 1 from public.mobility_fee_pix_invoice_lines_v1_837 l
                   where l.request_id=a.request_id)
  order by a.recorded_at,a.request_id
  limit 100
 ), counted as (
  select request_id,fee_cents,recorded_at,
  sum(fee_cents) over(order by recorded_at,request_id) as running
  from unbilled
 )
 select array_agg(request_id order by recorded_at,request_id),
        coalesce(sum(fee_cents),0)
 into v_ids,v_amount
 from counted where running<=1000000;
 if v_amount<100 or v_ids is null then
   return jsonb_build_object('status','below_minimum',
    'amountCents',coalesce(v_amount,0),'minCents',100);
 end if;
 insert into public.mobility_fee_pix_invoices_v1_837(
  id,driver_id,external_reference,amount_cents)
 values(v_id,p_driver,'mobility-fee:'||v_id::text,v_amount);
 insert into public.mobility_fee_pix_invoice_lines_v1_837(
  request_id,invoice_id,fee_cents)
 select a.request_id,v_id,a.fee_cents
 from public.mobility_platform_fee_accruals_v1_835 a
 where a.driver_id=p_driver and a.request_id=any(v_ids);
 get diagnostics v_rows=row_count;
 if v_rows<>cardinality(v_ids)
    or (select sum(fee_cents) from public.mobility_fee_pix_invoice_lines_v1_837
        where invoice_id=v_id)<>v_amount
 then raise exception 'MOBILITY_FEE_INVOICE_SUM_CONFLICT'
   using errcode='40001';end if;
 return jsonb_build_object('invoiceId',v_id,'status','prepared',
   'amountCents',v_amount,'externalReference','mobility-fee:'||v_id::text,
   'createdAt',(select created_at from public.mobility_fee_pix_invoices_v1_837
                where id=v_id));
end;
$$;
revoke all on function public.mobility_fee_pix_prepare_v1_837(uuid)
 from public,anon,authenticated;
grant execute on function public.mobility_fee_pix_prepare_v1_837(uuid)
 to service_role;

-- Vinculação exata de uma Order/Payment, ambos criados pelo MP. Não
-- aceita alterar a fatura nem reutilizar Order de outro Pix. A data persistida
-- de criação é o limite conservador de P1D; respostas tardias não a prorrogam.
create or replace function public.mobility_fee_pix_commit_v1_837(
 p_invoice uuid,p_driver uuid,p_order text,p_payment text,
 p_br_code text,p_qr_image text,p_link_url text,p_expires timestamptz
) returns jsonb language plpgsql security definer set search_path=pg_catalog
as $$
declare
 v_invoice public.mobility_fee_pix_invoices_v1_837%rowtype;
begin
 select * into v_invoice from public.mobility_fee_pix_invoices_v1_837
 where id=p_invoice and driver_id=p_driver for update;
 if not found then raise exception 'MOBILITY_FEE_PIX_NOT_FOUND' using errcode='42501';end if;
 if p_order is null or length(p_order) not between 8 and 200
 or p_order !~ '^[A-Za-z0-9_-]+$'
 or p_payment is null or length(p_payment) not between 3 and 200
 or p_payment !~ '^[A-Za-z0-9_-]+$'
 or p_br_code is null or length(p_br_code) not between 20 and 8192
 or p_expires is null or p_expires<=clock_timestamp()+interval '60 seconds'
 or p_expires>v_invoice.created_at+interval '24 hours'
 or (p_qr_image is not null and (
     length(p_qr_image)>550100 or p_qr_image !~ '^data:image/png;base64,[A-Za-z0-9+/=]+$'))
 or (p_link_url is not null and (length(p_link_url)>2000
     or p_link_url !~ '^https://'))
 then raise exception 'MOBILITY_FEE_PIX_PROOF_INVALID' using errcode='22023';end if;
 if (select coalesce(sum(fee_cents),0) from public.mobility_fee_pix_invoice_lines_v1_837
     where invoice_id=p_invoice)<>v_invoice.amount_cents
 then raise exception 'MOBILITY_FEE_PIX_LINES_CONFLICT' using errcode='40001';end if;
 if v_invoice.status='active'
    and v_invoice.provider_order_id=p_order
    and v_invoice.provider_payment_id=p_payment
    and v_invoice.pix_br_code=p_br_code
 then return jsonb_build_object('invoiceId',p_invoice,'status','active',
    'amountCents',v_invoice.amount_cents,'replayed',true);end if;
 if v_invoice.status<>'prepared' then
  raise exception 'MOBILITY_FEE_PIX_ALREADY_COMMITTED' using errcode='23505';end if;
 update public.mobility_fee_pix_invoices_v1_837
 set status='active',provider_order_id=p_order,provider_payment_id=p_payment,
 pix_br_code=p_br_code,pix_qr_data_uri=p_qr_image,payment_link_url=p_link_url,
 expires_at=p_expires,updated_at=clock_timestamp()
 where id=p_invoice and status='prepared';
 return jsonb_build_object('invoiceId',p_invoice,'status','active',
    'amountCents',v_invoice.amount_cents,'replayed',false);
end;
$$;
revoke all on function public.mobility_fee_pix_commit_v1_837(
 uuid,uuid,text,text,text,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.mobility_fee_pix_commit_v1_837(
 uuid,uuid,text,text,text,text,text,timestamptz) to service_role;

-- RPC abaixo é invocada APENAS após HMAC válido e GET da mesma Order
-- feito com token do recebedor TAMÃO. Não confiar em valor do payload webhook.
create or replace function public.mobility_fee_pix_apply_proof_v1_837(
 p_invoice uuid,p_order text,p_payment text,p_amount_cents integer,
 p_state text,p_evidence_sha256 text
) returns jsonb language plpgsql security definer set search_path=pg_catalog
as $$
declare
 v_invoice public.mobility_fee_pix_invoices_v1_837%rowtype;
 v_prior public.mobility_fee_pix_evidence_v1_837%rowtype;
begin
 select * into v_invoice from public.mobility_fee_pix_invoices_v1_837
 where id=p_invoice for update;
 if not found or v_invoice.provider_order_id is distinct from p_order
 or v_invoice.provider_payment_id is distinct from p_payment
 or v_invoice.amount_cents is distinct from p_amount_cents
 or p_state not in ('paid','expired','review_required')
 or p_evidence_sha256 !~ '^[0-9a-f]{64}$'
 then raise exception 'MOBILITY_FEE_PSP_PROOF_MISMATCH' using errcode='42501';end if;
 if p_state='paid' and v_invoice.status not in ('active','expired','paid')
 or p_state='expired' and v_invoice.status not in ('active','expired')
 or p_state='review_required' and v_invoice.status not in
    ('active','paid','expired','review_required')
 then raise exception 'MOBILITY_FEE_PSP_STATE_CONFLICT' using errcode='23505';end if;
 insert into public.mobility_fee_pix_evidence_v1_837(
  invoice_id,event_state,provider_order_id,provider_payment_id,
  amount_cents,evidence_hash)
 values(p_invoice,p_state,p_order,p_payment,p_amount_cents,p_evidence_sha256)
 on conflict(invoice_id,event_state) do nothing;
 select * into v_prior from public.mobility_fee_pix_evidence_v1_837
 where invoice_id=p_invoice and event_state=p_state;
 if not found or v_prior.evidence_hash<>p_evidence_sha256
 or v_prior.provider_order_id<>p_order or v_prior.provider_payment_id<>p_payment
 or v_prior.amount_cents<>p_amount_cents
 then raise exception 'MOBILITY_FEE_PSP_REPLAY_CONFLICT' using errcode='23505';end if;
 if v_invoice.status='paid' and p_state='expired' then
  raise exception 'MOBILITY_FEE_PAID_CANNOT_EXPIRE' using errcode='23505';
 end if;
 if v_invoice.status is distinct from p_state then
  update public.mobility_fee_pix_invoices_v1_837
   set status=p_state,
       paid_at=case when p_state='paid' then clock_timestamp() else paid_at end,
       review_at=case when p_state='review_required' then clock_timestamp() else review_at end,
       provider_evidence_hash=case when p_state='paid' then p_evidence_sha256
                                 else provider_evidence_hash end,
       last_provider_state=p_state,updated_at=clock_timestamp()
  where id=p_invoice;
 end if;
 return jsonb_build_object('invoiceId',p_invoice,'status',p_state,
   'replayed',v_invoice.status=p_state,
   'amountCents',v_invoice.amount_cents);
end;
$$;
revoke all on function public.mobility_fee_pix_apply_proof_v1_837(
 uuid,text,text,integer,text,text) from public,anon,authenticated;
grant execute on function public.mobility_fee_pix_apply_proof_v1_837(
 uuid,text,text,integer,text,text) to service_role;

-- Pagamento pode chegar depois que a Order foi criada, mas antes de a
-- resposta/commit gravar o QR. Recuperar SEM inventar QR ou nova Order:
-- somente após GET independente da Order processada no token TAMÃO.
create or replace function public.mobility_fee_pix_recover_paid_v1_837(
 p_invoice uuid,p_driver uuid,p_order text,p_payment text,
 p_amount_cents integer,p_evidence_sha256 text
) returns jsonb language plpgsql security definer set search_path=pg_catalog
as $$
declare
 v_invoice public.mobility_fee_pix_invoices_v1_837%rowtype;
 v_previous public.mobility_fee_pix_evidence_v1_837%rowtype;
begin
 select * into v_invoice from public.mobility_fee_pix_invoices_v1_837
 where id=p_invoice and driver_id=p_driver for update;
 if not found or v_invoice.external_reference<>'mobility-fee:'||p_invoice::text
  or p_order is null or p_order !~ '^[A-Za-z0-9_-]{8,200}$'
  or p_payment is null or p_payment !~ '^[A-Za-z0-9_-]{3,200}$'
  or v_invoice.amount_cents is distinct from p_amount_cents
  or p_evidence_sha256 !~ '^[0-9a-f]{64}$'
  or (select coalesce(sum(fee_cents),0)
    from public.mobility_fee_pix_invoice_lines_v1_837
    where invoice_id=p_invoice)<>v_invoice.amount_cents
 then raise exception 'MOBILITY_FEE_EARLY_PAYMENT_MISMATCH'
   using errcode='42501';end if;
 if v_invoice.status='paid' and v_invoice.provider_order_id=p_order
  and v_invoice.provider_payment_id=p_payment
  and v_invoice.provider_evidence_hash=p_evidence_sha256
 then return jsonb_build_object('status','paid','replayed',true);end if;
 if v_invoice.status<>'prepared' or v_invoice.provider_order_id is not null
 then raise exception 'MOBILITY_FEE_EARLY_PAYMENT_STATE_CONFLICT'
   using errcode='23505';end if;
 insert into public.mobility_fee_pix_evidence_v1_837(
   invoice_id,event_state,provider_order_id,provider_payment_id,
   amount_cents,evidence_hash)
 values (p_invoice,'paid',p_order,p_payment,p_amount_cents,p_evidence_sha256)
 on conflict(invoice_id,event_state) do nothing;
 select * into v_previous from public.mobility_fee_pix_evidence_v1_837
 where invoice_id=p_invoice and event_state='paid';
 if not found or v_previous.evidence_hash<>p_evidence_sha256
  or v_previous.provider_order_id<>p_order
  or v_previous.provider_payment_id<>p_payment
  or v_previous.amount_cents<>p_amount_cents
 then raise exception 'MOBILITY_FEE_EARLY_PAYMENT_REPLAY_CONFLICT'
  using errcode='23505';end if;
 update public.mobility_fee_pix_invoices_v1_837
 set status='paid',provider_order_id=p_order,provider_payment_id=p_payment,
 paid_at=clock_timestamp(),provider_evidence_hash=p_evidence_sha256,
 last_provider_state='paid',updated_at=clock_timestamp()
 where id=p_invoice;
 return jsonb_build_object('status','paid','replayed',false);
end;
$$;
revoke all on function public.mobility_fee_pix_recover_paid_v1_837(
 uuid,uuid,text,text,integer,text) from public,anon,authenticated;
grant execute on function public.mobility_fee_pix_recover_paid_v1_837(
 uuid,uuid,text,text,integer,text) to service_role;
