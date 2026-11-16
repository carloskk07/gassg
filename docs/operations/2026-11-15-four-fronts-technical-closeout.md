# TAMÃO — dossiê de encerramento técnico das frentes #2, #3, #4 e #6

**Data:** 15/11/2026 (horário do Brasil). **Base analisada:** `main=3b44b373e52c4aac85a7d9e29acd0613e2d4da58`, com matriz de aceite separando desenvolvimento, captação e operação comercial ([PR #1023](https://github.com/carloskk07/gassg/pull/1023)).

## Decisão de classificação

**Quatro frentes são elegíveis ao encerramento TÉCNICO**, mediante Audit, integração isolada, build, publicação e readiness aprovados na PR deste dossiê. A classificação é sobre software, não sobre uma operação bancária ou fornecedor existentes. A **#12 não está encerrada** porque há funcionalidades de software ainda não entregues.

| Frente | Aceite técnico existente e reproduzível | Decisão |
|---|---|---|
| **#2 — Cupons** | Clique real do Clube, consentimento, idempotência, troca de conta; Pix sintético, emissão, reserva/aplicação, limite mínimo, resgate, cancelamento, reembolso e ressarcimento, com papéis e ledger no PostgreSQL completo | **Encerrar tecnicamente** |
| **#3 — Central Financeira** | Regras de cobrança e conciliação nas famílias de receitas da plataforma; NET, prova por entidade, recuperações, devolução, proteção contra dupla baixa e retorno; testes de Ads, mobilidade, plano da revenda e cupons | **Encerrar tecnicamente** |
| **#4 — Pedidos/entregas** | Chrome e Auth/Edge/PG descartáveis: Cliente → oferta → cotação → pedido → Parceiro → PIN/entrega → pedido encerrado → Admin, cancelamento, estorno, papéis, suporte, cenário offline | **Encerrar tecnicamente** |
| **#6 — Revendas** | Cadastro/autorização, identidade, compliance/ANP simulado, oferta, preço, estoque, limites por cidade, planos pré-pagos e débito por pedido, bloqueio com zero revendas aptas | **Encerrar tecnicamente** |
| **#12 — Rede** | Indicação direta, qualificação, comissão, carência, fraude, reversão e declaração de saída validados. **NÃO** equivale a rede multinível, prêmio de revenda indicada nem saque automático completo | **Manter aberta por funcionalidade ausente** |

## Provas contínuas ancoradas em código, não em declarações

### #2 — Cupons

- [Clique real](../../tests/clube-coupon-purchase-click-journey.mjs): consentimento, duplo clique, recuperação do mesmo Pix e troca de sessão, inclusive a correção reproduzida em vermelho antes da [PR #1022](https://github.com/carloskk07/gassg/pull/1022).
- [Integração SQL completa](../../tests/isolated-supabase-coupon-full-schema.mjs): cupom pago, revenda, desconto aplicado no pedido, bloqueios, cancelamento, estorno, saldo, ressarcimento e proteção contra crédito indevido; sem alegar dinheiro real.
- [Devolução individual](../../tests/isolated-supabase-coupon-refund-v1-814.mjs) e [patrocínio](../../tests/isolated-clube-sponsored-redemption-v1-956.mjs), com execução na integração descartável.
- Prova pré-existente **real**, mas com ciclo original encerrado: Pix R$ 8,90 devolvido; três vouchers anulados. Isso **não** comprova consumo comercial de outro cupom e **não** deve bloquear software pronto.

### #3 — Central Financeira

- [Entitlement e leitura original por modalidade](../../tests/isolated-payment-entitlement-readback.mjs): `coupon`, `merchant_sale`, `advertising`, `mobility`; preservação de ROLLBACK.
- [Publicidade](../../tests/isolated-ads-independent-full-cycle-v1-955.mjs), [Pix/taxas de mobilidade](../../tests/isolated-mobility-fee-pix-v1-837.mjs), [planos da revenda](../../tests/isolated-merchant-prepaid-lifecycle-v1-953.mjs), [declaração/reversão financeira da indicação](../../tests/isolated-referral-payout-lifecycle.mjs).
- Reconciliações originais efetivas: Essencial R$ 19,90 bruto / R$ 19,70 líquido, publicidade R$ 19,90 bruto / R$ 19,70 líquido, cupom devolvido com R$ 8,81 NET **apenas histórico**. Não repetir Pix. Saques automáticos do sistema de Rede são escopo pendente da #12, não da rotina genérica de conciliação de receitas da plataforma.
- Conciliação, idempotência e apresentação de pagamento **não são prova de transferência externa que não existiu**.

### #4 — Pedidos e entregas

- [Jornada positiva integrada](../../tests/isolated-supabase-positive-checkout.mjs): Postgres com migrações completas, Auth/Edge reais isolados, comprador, revenda, entregador e Admin, cotação, ordem, aceite, PIN, entrega, reconsulta em telas e papéis separados.
- [Pedido com cupom e reversão](../../tests/isolated-supabase-coupon-full-schema.mjs) e [suporte por pedido](../../tests/isolated-support-positive-journey.mjs).
- A prova física de entrega é um **evento da operação que virá**, não um bloqueio do término do mecanismo de pedido.

### #6 — Revendas

- [Jornada integrada](../../tests/isolated-supabase-positive-checkout.mjs): revenda sintética com autorização/compliance simulado, limites de GLP/ANP e ofertas; registro no banco de descarte.
- [Gates de ativação](../../tests/isolated-commercial-activation-evidence.mjs): a ausência de revenda habilitada impede efetuar pedidos reais, mesmo sob tentativa de abrir `PILOT`; a captação continua independente.
- [Planos/consumo](../../tests/isolated-merchant-prepaid-lifecycle-v1-953.mjs): quatro planos, crédito/reserva, cobrança por pedido/PIN, reversão e proibição de valores duplicados.
- Uma **empresa ainda não cadastrada** não é erro do cadastro. Quando existir uma revenda real, seu CNPJ, ANP quando aplicável, estoque, responsável e rota de pagamento devem ser conferidos antes de vender, sem desbloqueio falso.

## Limite explícito da frente #12 — não encerrada

O software implementa **a indicação direta** e o controle dos repasses declarados. A documentação e os testes demonstram que **ainda faltam escopo de implementação** para a rede multinível remunerada, para o incentivo econômico efetivo a revendas que indicam outras revendas e para um fluxo confiável de pedido/autorização/execução de saque automático. A [política de simulação de indicação de revenda](../../MARKETING.md) ainda mantém `reward_enabled=false` e nenhuma concessão. [Payouts V1.265](../TAMAO-V1-265-MP-PAYOUTS-READONLY.md) é **somente GET de observação**, não POST de transferência.

**Sequência de engenharia da #12:** estabelecer política versionada e financeiramente conservadora de níveis/cap de comissão, vincular atribuição e antifraude à fonte real de taxa, testar concorrência/maturação/estorno e identidade, criar solicitação de saque e aprovação segura com idempotência, tratar integração executora autorizada somente se PSP admitir a operação, manter operações manuais/auditadas como alternativa. Validar integralmente em ambiente isolado. Não fingir transferência bancária nem prometer saque automático sem implementação.

## Critério de aprovação e fontes concretas

A evidência técnica anterior é reproduzível em CI, não por `HTTP 200` isolado:

- [Integração descartável #43778330534](https://github.com/carloskk07/gassg/actions/runs/43778330534): SUCCESS (Auth, Edge, PostgreSQL, cupons, pedidos, revendas, Pix e conferência financeira).
- [Audit #43778819991](https://github.com/carloskk07/gassg/actions/runs/43778819991): SUCCESS.
- [Cloudflare #43778820004](https://github.com/carloskk07/gassg/actions/runs/43778820004), [readiness #43778820065](https://github.com/carloskk07/gassg/actions/runs/43778820065) e [reconciliação nativa #43778981962](https://github.com/carloskk07/gassg/actions/runs/43778981962): SUCCESS, SHA coincidente nos três portais.
- O [guard recorrente de 21 vínculos](../../tests/homologation-five-fronts-gates.mjs) mantém as cinco frentes sob regressão Audit/integração isolada. Ele **não** executa sozinho cada cenário; os respectivos jobs devem estar verdes.

**Operação externa:** não se exige revenda, cliente, entrega, consumo de cupom, saque ou depósito real para **encerrar desenvolvimento**. Isso não exime validações da revenda ou provas de transações **quando acontecerem**. Estado de comércio e gates de segurança devem permanecer intactos, sem modificar `commerce_enabled`, dinheiro, provedor ou usuários reais.

### Contagem após os gates da PR deste dossiê

**18/19 frentes tecnicamente concluídas; só #12 permanece aberta por escopo de software.** A atualização do contador na issue #493 e na matriz só é definitiva após a CI e a publicação deste dossiê. Não declarar 19/19 antes da rede completa.
