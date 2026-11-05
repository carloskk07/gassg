-- TAMÃO #838: carteira segregada de crédito pré-pago para TAXAS de moto/carro.
-- A venda Pix de cada recarga permanece desativada até a integração PSP.
-- Não é carteira do cliente, não quita a tarifa da corrida, nem cria dinheiro.
alter table public.mobility_fee_pix_invoices_v1_837
 add column invoice_kind text not null default 'fee'
 check(invoice_kind in ('fee','prepaid_credit')),
 add column plan_key text,
 add column plan_fee_bps integer,
 add column grant_cents integer;
alter table public.mobility_fee_pix_invoices_v1_837
 add constraint mobility_credit_invoice_snapshot_v1_838_chk check(
  (invoice_kind='fee' and plan_key is null and plan_fee_bps is null and grant_cents is null)
  or (invoice_kind='prepaid_credit' and plan_key is not null
      and plan_fee_bps between 500 and 600
      and grant_cents=amount_cents and amount_cents>=100));

create table public.mobility_fee_prepaid_lots_v1_838(
 invoice_id uuid primary key references public.mobility_fee_pix_invoices_v1_837(id) on delete restrict,
 driver_id uuid not null references auth.users(id) on delete restrict,
 plan_key text not null,
 fee_bps integer not null check(fee_bps in (500,550,600)),
 funded_cents integer not null check(funded_cents>=100),
 reserved_cents integer not null default 0 check(reserved_cents>=0),
 spent_cents integer not null default 0 check(spent_cents>=0),
 status text not null default 'active' check(status in ('active','under_review')),
 funded_at timestamptz not null default clock_timestamp(),
 check(reserved_cents+spent_cents<=funded_cents)
);
create index mobility_prepaid_driver_fifo_v1_838_idx
 on public.mobility_fee_prepaid_lots_v1_838(driver_id,funded_at,invoice_id);

create table public.mobility_fee_prepaid_uses_v1_838(
 request_id uuid primary key references public.mobility_requests(id) on delete restrict,
 invoice_id uuid not null references public.mobility_fee_prepaid_lots_v1_838(invoice_id) on delete restrict,
 driver_id uuid not null references auth.users(id) on delete restrict,
 fee_bps integer not null check(fee_bps in (500,550,600)),
 reserved_cents integer not null check(reserved_cents>0),
 status text not null default 'reserved' check(status in ('reserved','spent','released')),
 reserved_at timestamptz not null default clock_timestamp(),
 settled_at timestamptz
);
create index mobility_prepaid_use_lot_v1_838_idx
 on public.mobility_fee_prepaid_uses_v1_838(invoice_id);
alter table public.mobility_fee_prepaid_lots_v1_838 enable row level security;
alter table public.mobility_fee_prepaid_uses_v1_838 enable row level security;
revoke all on public.mobility_fee_prepaid_lots_v1_838,
 public.mobility_fee_prepaid_uses_v1_838 from public,anon,authenticated;

-- Grant happens ONLY after provider-proofed payment, using immutable invoice
-- amount/plan snapshots. A new or replayed paid event cannot double-grant.
create or replace function public.mobility_fee_prepaid_fund_v1_838()
returns trigger language plpgsql security definer set search_path=pg_catalog
as $$
declare v_prior public.mobility_fee_prepaid_lots_v1_838%rowtype;
begin
 if new.invoice_kind<>'prepaid_credit' or new.status=old.status then return new;end if;
 if new.status='paid' then
  if new.provider_evidence_hash is null or not exists(
    select 1 from public.mobility_fee_pix_evidence_v1_837 e
    where e.invoice_id=new.id and e.event_state='paid'
     and e.evidence_hash=new.provider_evidence_hash
     and e.amount_cents=new.amount_cents
     and e.provider_order_id=new.provider_order_id
     and e.provider_payment_id=new.provider_payment_id
  ) then raise exception 'MOBILITY_PREPAID_PROVIDER_PROOF_MISSING' using errcode='40001';end if;
  insert into public.mobility_fee_prepaid_lots_v1_838(
    invoice_id,driver_id,plan_key,fee_bps,funded_cents)
  values(new.id,new.driver_id,new.plan_key,new.plan_fee_bps,new.grant_cents)
  on conflict(invoice_id) do nothing;
  select * into v_prior from public.mobility_fee_prepaid_lots_v1_838
  where invoice_id=new.id;
  if not found or v_prior.driver_id<>new.driver_id
   or v_prior.plan_key<>new.plan_key or v_prior.fee_bps<>new.plan_fee_bps
   or v_prior.funded_cents<>new.grant_cents
  then raise exception 'MOBILITY_PREPAID_DOUBLE_GRANT_CONFLICT' using errcode='23505';end if;
 elsif new.status='review_required' then
  update public.mobility_fee_prepaid_lots_v1_838 set status='under_review'
  where invoice_id=new.id;
 end if;
 return new;
end;
$$;
revoke all on function public.mobility_fee_prepaid_fund_v1_838() from public,anon,authenticated;
create trigger mobility_prepaid_fund_v1_838_trg
 after update of status on public.mobility_fee_pix_invoices_v1_837
 for each row execute function public.mobility_fee_prepaid_fund_v1_838();

-- Only already funded lots may reserve credit. One lock per driver prevents
-- simultaneous accepts from promising the same cent to two rides.
create or replace function public.mobility_fee_prepaid_reserve_v1_838(
 p_request uuid,p_driver uuid,p_net_cents integer
) returns jsonb language plpgsql security definer set search_path=pg_catalog
as $$
declare
 v_lot public.mobility_fee_prepaid_lots_v1_838%rowtype;
 v_fee integer;
 v_prior public.mobility_fee_prepaid_uses_v1_838%rowtype;
begin
 if p_driver is null or p_request is null
   or p_net_cents<100 or p_net_cents>10000000
 then raise exception 'MOBILITY_PREPAID_INVALID_FARE' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('mobility-prepaid:'||p_driver::text,0));
 select * into v_prior from public.mobility_fee_prepaid_uses_v1_838
 where request_id=p_request;
 if found then
  if v_prior.driver_id<>p_driver then
   raise exception 'MOBILITY_PREPAID_REQUEST_REBOUND' using errcode='23505';end if;
  return jsonb_build_object('rateBps',v_prior.fee_bps,'feeCents',v_prior.reserved_cents,
   'invoiceId',v_prior.invoice_id,'status',v_prior.status);
 end if;
 for v_lot in
  select * from public.mobility_fee_prepaid_lots_v1_838 l
  where l.driver_id=p_driver and l.status='active'
   and exists(select 1 from public.mobility_fee_pix_invoices_v1_837 i
    where i.id=l.invoice_id and i.status='paid')
  order by l.funded_at,l.invoice_id for update
 loop
  v_fee:=round(p_net_cents::numeric*v_lot.fee_bps/10000)::integer;
  if v_fee<=0 or v_lot.reserved_cents+v_lot.spent_cents+v_fee>v_lot.funded_cents
  then continue;end if;
  insert into public.mobility_fee_prepaid_uses_v1_838(
    request_id,invoice_id,driver_id,fee_bps,reserved_cents)
  values(p_request,v_lot.invoice_id,p_driver,v_lot.fee_bps,v_fee);
  update public.mobility_fee_prepaid_lots_v1_838
   set reserved_cents=reserved_cents+v_fee
   where invoice_id=v_lot.invoice_id and status='active'
    and reserved_cents+spent_cents+v_fee<=funded_cents;
  if not found then raise exception 'MOBILITY_PREPAID_RESERVE_RACE' using errcode='40001';end if;
  return jsonb_build_object('rateBps',v_lot.fee_bps,'feeCents',v_fee,
   'invoiceId',v_lot.invoice_id,'status','reserved');
 end loop;
 return null;
end;
$$;
revoke all on function public.mobility_fee_prepaid_reserve_v1_838(uuid,uuid,integer)
 from public,anon,authenticated;

create or replace function public.mobility_fee_prepaid_settle_v1_838()
returns trigger language plpgsql security definer set search_path=pg_catalog
as $$
declare v_use public.mobility_fee_prepaid_uses_v1_838%rowtype;
begin
 if new.status is not distinct from old.status or
    new.status not in ('completed','cancelled','expired','rejected') then return new;end if;
 select * into v_use from public.mobility_fee_prepaid_uses_v1_838
 where request_id=new.id for update;
 if not found or v_use.status<>'reserved' then return new;end if;
 if v_use.driver_id<>new.driver_id then
  raise exception 'MOBILITY_PREPAID_SETTLEMENT_DRIVER_CHANGED' using errcode='40001';end if;
 perform pg_advisory_xact_lock(hashtextextended('mobility-prepaid:'||new.driver_id::text,0));
 update public.mobility_fee_prepaid_lots_v1_838
 set reserved_cents=reserved_cents-v_use.reserved_cents,
  spent_cents=spent_cents+case when new.status='completed' then v_use.reserved_cents else 0 end
 where invoice_id=v_use.invoice_id and reserved_cents>=v_use.reserved_cents;
 if not found then raise exception 'MOBILITY_PREPAID_SETTLEMENT_MISMATCH' using errcode='40001';end if;
 update public.mobility_fee_prepaid_uses_v1_838
 set status=case when new.status='completed' then 'spent' else 'released' end,
 settled_at=clock_timestamp()
 where request_id=new.id and status='reserved';
 return new;
end;
$$;
revoke all on function public.mobility_fee_prepaid_settle_v1_838() from public,anon,authenticated;
create trigger mobility_zy_prepaid_settle_v1_838_trg
 after update of status on public.mobility_requests
 for each row execute function public.mobility_fee_prepaid_settle_v1_838();
