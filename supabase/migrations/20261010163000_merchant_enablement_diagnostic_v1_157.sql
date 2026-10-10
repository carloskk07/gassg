-- V1.157: admin-only, read-only operational diagnostics.
-- Mirrors V1.152 merchant-city quotation gates; never toggles flags or overrides controls.
create or replace function public.admin_merchant_enablement_v1_157(p_limit integer default 80)
returns table(
  merchant_id uuid, merchant_name text, cnpj text, city text, state text,
  merchant_status text, ready boolean, blocker_count integer,
  checks jsonb, checked_at timestamptz
)
language sql stable security definer
set search_path to pg_catalog
as $func$
with target as materialized (
  select m.id,m.name,m.cnpj,m.status,m.online,m.accepts_citywide,
    m.last_seen_at,m.delivery_fee_confirmed_at,
    d.city,d.state
  from public.merchants m
  left join public.merchant_business_details d on d.merchant_id=m.id
  order by m.created_at desc,m.id
  limit least(greatest(coalesce(p_limit,80),1),100)
), checked as (
  select t.*,
    (coalesce(t.city,'')<>'' and t.state ~ '^[A-Z]{2}$') as has_region,
    exists (
      select 1 from public.platform_launch_control lc
      where lc.singleton and lc.commerce_enabled and lc.operation_mode in ('LIVE','PILOT')
    ) as global_commerce_enabled,
    public.merchant_allowed_in_operation_mode(t.id) as mode_allowed,
    public.merchant_cnpj_compliance_current(t.id) as cnpj_ok,
    public.merchant_anp_compliance_current(t.id) as anp_ok,
    public.merchant_financial_sales_allowed(t.id) as finance_ok,
    exists (
      select 1 from public.catalog_items ci
      where ci.merchant_id=t.id and ci.active
        and ci.available_stock>0 and ci.price_cents>0
        and ci.price_confirmed_at>=statement_timestamp()-interval '24 hours'
    ) as stock_price_ok,
    exists (
      select 1 from public.merchant_payment_methods pm
      where pm.merchant_id=t.id and pm.active
    ) as payment_method_ok,
    exists (
      select 1 from public.merchant_payment_routes pr
      where pr.merchant_id=t.id and pr.active
    ) as payment_route_ok,
    not exists (
      select 1 from public.market_cities mc
      where mc.state=upper(trim(t.state))
        and mc.city_key=public.market_city_key(t.city)
        and mc.admin_paused
    ) as city_not_paused,
    case
      when t.state ~ '^[A-Z]{2}$' and length(coalesce(t.city,''))>=2 then
        t.id=any(public.market_city_offer_scope(t.city,t.state))
      else false
    end as authoritative_offer_ready
  from target t
)
select c.id,c.name,c.cnpj,c.city,c.state,c.status,
  c.authoritative_offer_ready as ready,
  (select count(*)::integer from (
      values
      (c.status='active'),
      (c.online),
      (c.accepts_citywide),
      (c.last_seen_at>=statement_timestamp()-interval '10 minutes'),
      (c.delivery_fee_confirmed_at>=statement_timestamp()-interval '24 hours'),
      (c.has_region),
      (c.cnpj_ok),
      (c.anp_ok),
      (c.mode_allowed),
      (c.global_commerce_enabled),
      (c.city_not_paused),
      (c.finance_ok),
      (c.stock_price_ok),
      (c.payment_method_ok),
      (c.payment_route_ok),
      (c.authoritative_offer_ready)
    ) as req(ok) where req.ok is not true) as blocker_count,
  (select coalesce(jsonb_agg(
      jsonb_build_object('key',req.key,'label',req.label,'ok',coalesce(req.ok,false),
        'action',req.action,'owner',req.owner,'scope',req.scope)
       order by req.sort
    ),'[]'::jsonb)
    from (values
      (10,'merchant_status','Cadastro e ativação',c.status='active',
        'Validar e ativar o cadastro no Admin após aprovação documental','admin','merchant'),
      (20,'cnpj','Regularidade do CNPJ',c.cnpj_ok,
        'Conferir documento, validade e confirmação do CNPJ','admin','merchant'),
      (30,'anp','Regularidade ANP quando houver GLP ativo',c.anp_ok,
        'Conferir autorização ANP quando a revenda anunciar GLP','admin','merchant'),
      (40,'operation_mode','Modo operacional da revenda',c.mode_allowed,
        'Verificar regras do modo operacional vigente, inclusive exigências específicas','admin','global'),
      (50,'global_commerce','Comércio habilitado na plataforma',c.global_commerce_enabled,
        'Verificar controles globais do TAMÃO; não habilitar vendas somente para eliminar bloqueio','admin','global'),
      (60,'location','Município e UF informados',c.has_region,
        'Conferir o endereço da revenda e seu município de atuação','admin','merchant'),
      (70,'city_pause','Cidade sem pausa administrativa',c.city_not_paused,
        'Conferir o motivo de pausa da cidade no painel de expansão','admin','city'),
      (80,'financial','Situação financeira liberada',c.finance_ok,
        'Conferir suspensão de vendas e pendências financeiras','admin','merchant'),
      (90,'inventory','Produto ativo com estoque e preço recente',c.stock_price_ok,
        'Ativar um produto permitido, informar estoque positivo e confirmar preço atualizado','merchant','merchant'),
      (100,'payment_method','Forma de pagamento ativa',c.payment_method_ok,
        'Habilitar uma forma de pagamento aceita pelo estabelecimento','merchant','merchant'),
      (110,'payment_route','Rota de recebimento ativa',c.payment_route_ok,
        'Configurar e validar a rota de recebimento escolhida, sem envolver repasses do TAMÃO','merchant','merchant'),
      (120,'delivery_area','Cobertura de entrega da cidade',c.accepts_citywide,
        'Confirmar capacidade de atender a cidade conforme as regras do produto','merchant','merchant'),
      (130,'delivery_fee','Preço de entrega atualizado',c.delivery_fee_confirmed_at>=statement_timestamp()-interval '24 hours',
        'Confirmar taxa de entrega da revenda para os próximos pedidos','merchant','merchant'),
      (140,'online','Revenda disponível',c.online,
        'Entrar no painel da revenda e confirmar disponibilidade','merchant','realtime'),
      (150,'heartbeat','Presença atualizada',c.last_seen_at>=statement_timestamp()-interval '10 minutes',
        'Conferir conexão e presença recente da revenda','merchant','realtime'),
      (160,'quote_authority','Autorização final para novas cotações',c.authoritative_offer_ready,
        'Revisar os bloqueios acima; o motor de cotações é a autoridade final','system','realtime')
    ) as req(sort,key,label,ok,action,owner,scope)
  ) as checks,
  statement_timestamp() as checked_at
from checked c
order by c.authoritative_offer_ready asc, c.name,c.id;
$func$;
revoke all on function public.admin_merchant_enablement_v1_157(integer)
  from public,anon,authenticated;
grant execute on function public.admin_merchant_enablement_v1_157(integer)
  to service_role;
