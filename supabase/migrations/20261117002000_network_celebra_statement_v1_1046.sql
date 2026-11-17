-- TAMÃO V1.1046 — extend authenticated benefits ledger for seasonal rewards.
-- Uma única RPC privada, paginada, isolada pela identidade validada no Edge.
-- Movimentações da carteira NÃO são somadas ao fundo da Rede ou ao valor de cupons.
begin;

create or replace function public.network_member_benefit_statement_v1_1045(
 p_user uuid,p_category text default 'all',p_page integer default 1,p_limit integer default 12
) returns jsonb language plpgsql stable security definer
set search_path=pg_catalog as $fn$
declare
 v_items jsonb:='[]'::jsonb;v_has_more boolean:=false;
begin
 if p_user is null or not exists(select 1 from auth.users u
      where u.id=p_user and u.deleted_at is null) then
   raise exception 'BENEFIT_STATEMENT_INVALID_USER' using errcode='22023';
 end if;
 if p_category is null or p_category not in ('all','rede','cashback','clube')
   or p_page is null or p_page<1 or p_page>100
   or p_limit is null or p_limit<1 or p_limit>25 then
   raise exception 'BENEFIT_STATEMENT_INVALID_PAGE' using errcode='22023';
 end if;

 with events as (
  -- Wallet is already authoritative. Its negative entries are real debits,
  -- not new positive earnings; pending->available are two separate movements.
  select 'wallet:'||w.id::text as "eventId",
   case when w.bucket='cashback' then 'cashback' else 'rede' end as category,
   'wallet'::text as money_type,
   case w.entry_type
    when 'cashback_seed' then 'Crédito de boas-vindas'
    when 'cashback_reserve' then 'Cashback reservado'
    when 'cashback_release' then 'Cashback devolvido'
    when 'cashback_earn' then 'Cashback da sua compra'
    when 'cashback_reversal' then 'Cashback estornado'
    when 'referral_pending' then 'Indicação em validação'
    when 'referral_pending_release' then 'Comissão saiu da validação'
    when 'referral_available' then 'Comissão liberada'
    else 'Comissão revertida' end as title,
   case when w.bucket='cashback' then 'Clube TAMÃO'
     else 'Indicação por primeira compra' end as origin,
   case w.entry_type
    when 'cashback_seed' then 'Crédito promocional conforme as regras da campanha.'
    when 'cashback_reserve' then 'Valor reservado para uma compra; não é uma nova cobrança.'
    when 'cashback_release' then 'Reserva desfeita e crédito devolvido.'
    when 'cashback_earn' then 'Benefício de uma compra concluída.'
    when 'cashback_reversal' then 'Ajuste devido à reversão de uma compra.'
    when 'referral_pending' then 'Primeira compra atribuída, aguardando conferência.'
    when 'referral_pending_release' then 'Transferência contábil entre saldos; não é um novo ganho.'
    when 'referral_available' then 'Comissão conferida, sujeita às regras de retirada.'
    else 'Correção da comissão após revisão ou estorno.' end as detail,
   case w.entry_type
    when 'cashback_reserve' then 'reserved'
    when 'cashback_reversal' then 'reversed'
    when 'referral_reversal' then 'reversed'
    when 'referral_pending_release' then 'moved'
    when 'referral_pending' then 'pending'
    else 'recorded' end as status,
   w.amount_cents::bigint as "amountCents",
   (w.amount_cents::bigint*1000000) as "amountMicrocents",
   w.created_at as "occurredAt",
   'BRL'::text as unit
  from public.wallet_entries w where w.user_id=p_user

  union all
  -- Shared 10% pool is recorded in microcents and may be sub-cent.
  select 'pool:'||a.kind||':'||a.source_id::text||':shared',
   'rede','network',
   'Sua participação no fundo',
   case when a.kind='mobility_prepaid_fee' then 'Pacotes Moto/Carro'
     else 'Pacotes de revendas' end,
   'Parcela coletiva de pacotes conciliados para membros ativos; não é cashback.',
   case s.state when 'eligible' then 'validated'
      when 'reversed' then 'reversed' else 'pending' end,
   floor(a.equal_microcents::numeric/1000000)::bigint,
   a.equal_microcents,a.created_at,'BRL'
  from public.network_fee_package_awards_v1_1030 a
  join public.network_fee_package_sources_v1_1030 s using(kind,source_id)
  where a.user_id=p_user and a.equal_microcents>0
  union all
  select 'pool:'||a.kind||':'||a.source_id::text||':inviter',
   'rede','network','Indicação de revenda reconhecida',
   'Pacote de taxas da revenda',
   'Parcela de indicação já incluída nos 10% do fundo, não somada novamente.',
   case s.state when 'eligible' then 'validated'
      when 'reversed' then 'reversed' else 'pending' end,
   floor(a.inviter_microcents::numeric/1000000)::bigint,
   a.inviter_microcents,a.created_at,'BRL'
  from public.network_fee_package_awards_v1_1030 a
  join public.network_fee_package_sources_v1_1030 s using(kind,source_id)
  where a.user_id=p_user and a.inviter_microcents>0

  union all
  select 'ad:'||a.campaign_id::text,'rede','network',
   'Indicação de anunciante','Publicidade TAMÃO',
   'Bônus da primeira campanha paga, validado mas ainda não disponível para saque.',
   case a.status when 'reversed' then 'reversed' else 'validated' end,
   a.bonus_cents,a.bonus_cents*1000000,a.recorded_at,'BRL'
  from public.network_module_ads_bonus_awards_v1_1041 a
  where a.inviter_user_id=p_user

  union all
  select 'direct:'||a.module||':'||a.source_id::text,'rede','network',
   case a.module when 'club' then 'Indicação de pacote do Clube'
     else 'Indicação de motorista' end,
   case a.module when 'club' then 'Clube financiado por parceiro'
     else 'Pacote Moto/Carro' end,
   'Bônus direto sobre receita líquida verificada; não está disponível para saque.',
   case a.status when 'reversed' then 'reversed' else 'validated' end,
   a.bonus_cents,a.bonus_cents*1000000,a.recorded_at,'BRL'
  from public.network_direct_module_awards_v1_1044 a
  where a.inviter_user_id=p_user

  union all
  -- Seasonal commission is a separately budget-capped marketing expense.
  -- It is NOT a withdrawal balance and is never added to the base commission.
  select 'celebra:'||a.campaign_key||':'||a.origin_id::text,
   'rede','network','Bônus especial TAMÃO Celebra',
   c.title,
   'Recompensa extra da ocasião, sobre receita líquida comprovada. Ainda sem saque.',
   case a.status when 'reversed' then 'reversed' else 'validated' end,
   a.bonus_cents,a.bonus_cents*1000000,a.recorded_at,'BRL'
  from public.network_celebra_awards_v1_1046 a
  join public.network_celebra_campaigns_v1_1046 c on c.campaign_key=a.campaign_key
  where a.inviter_user_id=p_user

  union all
  -- Coupon face value is a discount instrument, NEVER a cash credit.
  select 'voucher:'||v.id::text,'clube','discount',
   case when v.status='redeemed' then 'Cupom utilizado'
     when v.status='void' or i.status<>'paid' then 'Cupom cancelado'
     when v.expires_at<=clock_timestamp() then 'Cupom vencido'
     when v.status='reserved' then 'Cupom reservado'
     when v.status='review_required' then 'Cupom em revisão'
     else 'Cupom recebido' end,
   'Cupons do Clube TAMÃO',
   'Valor de desconto condicionado às regras do cupom; não é dinheiro nem saldo para saque.',
   case when v.status='redeemed' then 'used'
     when v.status='void' or i.status<>'paid' then 'cancelled'
     when v.expires_at<=clock_timestamp() then 'expired'
     when v.status='reserved' then 'reserved'
     when v.status='review_required' then 'review'
     else 'available' end,
   v.face_cents::bigint,v.face_cents::bigint*1000000,v.created_at,'BRL'
  from public.clube_coupon_paid_issuances v
  join public.clube_coupon_paid_invoices i on i.id=v.invoice_id
  where v.customer_user_id=p_user

  union all
  -- These are requests for payments from the existing network 10% fund.
  -- Show a bank payment only after immutable receipt evidence exists.
  select 'withdrawal:'||p.id::text,'rede','transfer',
   case p.state when 'paid' then 'Saque pago'
     when 'approved' then 'Saque aprovado'
     when 'cancelled' then 'Saque cancelado'
     when 'review' then 'Saque em conferência'
     else 'Saque solicitado' end,
   'Retirada do fundo da Rede',
   case when p.state='paid' and p.bank_receipt_sha256 is not null
      and p.bank_reference is not null then 'Pagamento conferido com comprovante.'
     when p.state='approved' then 'Pagamento manual até três dias após aprovação.'
     else 'Solicitação não representa pagamento realizado.' end,
   case p.state when 'paid' then 'paid' when 'approved' then 'approved'
     when 'cancelled' then 'cancelled' when 'review' then 'review'
     else 'pending' end,
   p.amount_cents,p.amount_cents*1000000,p.requested_at,'BRL'
  from public.network_manual_payout_requests_v1_1034 p
  where p.user_id=p_user
 ),
 ordered as (
   select e.*,row_number() over(order by e."occurredAt" desc,e."eventId" desc) rn
   from events e where p_category='all' or e.category=p_category
 ),
 page_rows as (
   select * from ordered
   where rn between ((p_page-1)*p_limit+1) and (p_page*p_limit+1)
 )
 select
   coalesce(jsonb_agg(to_jsonb(p)-'rn' order by p.rn)
      filter(where p.rn<=p_page*p_limit),'[]'::jsonb),
   coalesce(bool_or(p.rn=p_page*p_limit+1),false)
 into v_items,v_has_more
 from page_rows p;

 return jsonb_build_object(
   'source','network_member_statement_v1_1045',
   'readOnly',true,'moneyMoved',false,
   'category',p_category,'page',p_page,'pageSize',p_limit,
   'hasMore',v_has_more,'items',v_items);
end $fn$;

revoke all on function public.network_member_benefit_statement_v1_1045(uuid,text,integer,integer)
  from public,anon,authenticated;
grant execute on function public.network_member_benefit_statement_v1_1045(uuid,text,integer,integer)
  to service_role;
commit;
