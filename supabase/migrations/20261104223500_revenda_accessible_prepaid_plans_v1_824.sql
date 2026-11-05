-- TAMÃO #824 — novas recargas acessíveis e Flex 9% para REVENDA.
-- Não confundir com mobilidade: seu módulo financeiro será independente.
-- Valores são pré-pagamento de TAXAS, sem geração de saldo antes de Pix confirmado.
-- Chaves antigas permanecem para FKs, contratos, estornos e trilha histórica.
do $$
begin
  if not exists(select 1 from public.merchant_billing_plans
                where plan_key='flex_daily' and billing_mode='postpaid_daily') then
    raise exception 'FLEX_BILLING_PLAN_MISSING';
  end if;
  if exists(select 1 from public.merchant_billing_plans
            where plan_key='flex_daily' and platform_fee_bps not in (850,900)) then
    raise exception 'FLEX_BILLING_RATE_CHANGED_REVIEW_REQUIRED';
  end if;
  if exists(
     select 1 from public.merchant_billing_accounts
     where plan_key in ('credit_300','credit_1000','credit_3000')
       and (credit_balance_cents>0 or credit_reserved_cents>0)
  ) then
    raise exception 'LEGACY_PREPAID_BALANCE_REVIEW_REQUIRED';
  end if;
end $$;

update public.merchant_billing_plans
set platform_fee_bps=900,
    policy_version=case when platform_fee_bps<>900 then policy_version+1 else policy_version end,
    last_change_reason='Plano Flex 9 por cento aprovado pelo proprietário - #824',
    updated_at=clock_timestamp()
where plan_key='flex_daily' and platform_fee_bps=850;

insert into public.merchant_billing_plans(
  plan_key,display_name,billing_mode,platform_fee_bps,
  purchase_amount_cents,credit_grant_cents,active,sort_order,
  policy_version,last_change_reason
)
values
 ('credit_01990','Essencial','prepaid_credit',800,1990,1990,true,20,1,'Novos pacotes acessiveis #824'),
 ('credit_04990','Popular','prepaid_credit',750,4990,4990,true,30,1,'Novos pacotes acessiveis #824'),
 ('credit_09990','Profissional','prepaid_credit',700,9990,9990,true,40,1,'Novos pacotes acessiveis #824'),
 ('credit_19990','Alto Volume','prepaid_credit',650,19990,19990,true,50,1,'Novos pacotes acessiveis #824')
on conflict(plan_key) do nothing;

do $$
declare v_bad integer;
begin
  select count(*) into v_bad from (
    values
     ('credit_01990','Essencial',800,1990,20),
     ('credit_04990','Popular',750,4990,30),
     ('credit_09990','Profissional',700,9990,40),
     ('credit_19990','Alto Volume',650,19990,50)
  ) expected(key,name,bps,cents,priority)
  left join public.merchant_billing_plans p on p.plan_key=expected.key
  where p.plan_key is null or p.display_name<>expected.name
     or p.billing_mode<>'prepaid_credit'
     or p.platform_fee_bps<>expected.bps
     or p.purchase_amount_cents<>expected.cents
     or p.credit_grant_cents<>expected.cents
     or p.sort_order<>expected.priority or not p.active;
  if v_bad<>0 then
    raise exception 'ACCESSIBLE_BILLING_CATALOG_CONFLICT';
  end if;
end $$;

-- Inativos para NOVAS compras, mas preservados para referência histórica.
-- Não mexer em cobranças em aberto ou em transações já snapshots.
update public.merchant_billing_plans
set active=false, policy_version=policy_version+1,
    last_change_reason='Catalogo anterior substituido por recargas acessiveis - #824',
    updated_at=clock_timestamp()
where plan_key in ('credit_300','credit_1000','credit_3000')
  and active;

-- Guard final: cinco planos ativos, de 9% a 6,5%; sem crédito inventado.
do $$
begin
 if (select count(*) from public.merchant_billing_plans where active)<>5
 or not exists(select 1 from public.merchant_billing_plans
  where plan_key='flex_daily' and active and platform_fee_bps=900) then
   raise exception 'ACCESSIBLE_BILLING_CATALOG_NOT_READY';
 end if;
end $$;
