# TAMÃO V1.259 — apuração de benefícios sem presumir desembolsos

## Escopo
Visão exclusivamente de leitura no Admin, na Central de financiamento e crescimento → Resultados. Apuração por competência em `America/Sao_Paulo` (até 50 campanhas), acessível a superadmin e finance ativos via `admin-ops`; RPC SQL apenas por `service_role`.

Quatro dimensões distintas:
1. **Concessão:** soma de `order_reward_grants` pelo mês de `created_at`, para cashback e indicação de clientes. Reversões são separadas; líquido = concedido − revertido, inclusive quando a reversão aconteceu depois do mês da concessão.
2. **Uso:** soma de `orders.cashback_reserved_cents` em pedidos com `status='SETTLED'`, `financial_state='settled'`, pagamento confirmado e `settled_at` dentro do mês. Reflete uso atualmente válido em pedidos liquidados. É uma dimensão de competência de liquidação e **não** coorte de créditos nascidos naquele mês; pode incluir créditos promocionais de outras origens.
3. **Disponibilização de indicações:** eventos de `wallet_entries` do mês (`referral_available`, `referral_reversal`). São movimentos internos entre buckets, **não transferências bancárias**.
4. **Campanha:** vinculação opcional e já validada entre pedido e alocação pela V1.252; concessões do mês pertencentes a esses pedidos são apresentadas por campanha. Não presume causalidade nem responsabilidade financeira da alocação. Linhas não vinculadas a campanha não somem do total geral.

Não somar concessão com uso. Não deduzir pagamentos externos pelos saldos de carteira, nem inferir a origem dos créditos consumidos. Orçamento alocado é planejamento separado, **não custo pago**.

## Estados não mensurados
- O financeiro atual não oferece razão rastreável de saque externo de recompensas; `externalPaidBenefitsCents=null` e `externalPayoutMeasured=false`. Não transformar `null` em R$ 0.
- Indicadores de desembolso para indicação de revendas e cupons do Clube permanecem `null` (não apurados), mesmo quando a campanha possui orçamento, oferta ou proposta.
- Não se calculam ROI, lucro, causalidade de anúncios, saldo bancário ou disponibilidade de caixa; o relatório não movimenta recursos, não habilita programa e não altera motor de recompensas.
- `merchant_cashback_reimbursements` registra obrigação/ressarcimento da revenda; não deve ser confundido com pagamento externo de benefício realizado pelo TAMÃO.

## Segurança e limites
- Função de apuração `platform_funding_private_v1_259.benefit_costs`: auth explícita, `SECURITY DEFINER` com `search_path=pg_catalog`, somente `service_role`, competência validada.
- Wrapper na API: `public.admin_owner_campaign_benefit_costs_v1_259` somente `service_role`.
- Validação rigorosa na Edge e no Admin dos valores, estados e identidades de campanha. A UI descarta dados de outro usuário ou competência, e nunca mostra identidades individuais.
- Limite de 50 campanhas no painel, com aviso de truncamento; totais gerais calculados de toda a base, não só das linhas exibidas.
- Sem backfill fictício: nenhuma concessão foi fabricada em produção. Dados reais podem permanecer vazios.

## Migração e teste
`supabase/migrations/20261014234000_owner_campaign_benefit_costs_v1_259.sql`
`tests/owner-campaign-benefit-costs-v1-259.mjs`

## Próximos passos
Para calcular custo **efetivamente desembolsado** e rentabilidade será necessário ledger auditável de payout externo, identificação da origem dos créditos utilizados, custos PSP e tributos, e conciliação financeira sem duplicidade. Uma UTM isolada não demonstra venda incremental.
