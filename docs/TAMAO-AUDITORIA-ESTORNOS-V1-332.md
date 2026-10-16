# TAMÃO V1.332 — Auditoria de estornos e proteção de ajustes financeiros

Data: 16 de outubro de 2026. Escopo: `public.reverse_settled_order_financials` no Supabase.

## Defeito encontrado

O estorno de uma venda liquidada insere um ajuste financeiro a favor da revenda caso a taxa TAMÃO já tenha sido paga, e outro a favor da plataforma caso um ressarcimento de cashback já tenha sido pago. A exclusividade por `(order_id,adjustment_type)` existe e o código faz `ON CONFLICT DO NOTHING`.

Até a V1.331, ao encontrar um registro preexistente de ajuste, a função **não validava** se a contraparte, o valor e a direção daquele ajuste coincidiam com a obrigação comprovada pelo recebível ou pelo ressarcimento. A reversão podia prosseguir e registrar `financial_state='reversed'` enquanto o ajuste relacionado representasse outro valor.

## Correção

Introduz duas flags locais, marcadas nos dois caminhos de reembolso da taxa e no caminho de recuperação de cashback. Depois de inserir/ignorar os ajustes e **antes** de atualizar o estado financeiro do pedido, a função exige que a obrigação persistida coincida com:
- `order_id` e `adjustment_type`;
- `merchant_id` correto;
- direção `platform_owes_merchant` para taxa ou `merchant_owes_platform` para cashback;
- valor exato `v_cash_refund_due` ou `v_reimbursement.cashback_cents`.

Falhas resultam em `REVERSAL_FEE_ADJUSTMENT_SNAPSHOT_CONFLICT` ou `REVERSAL_CASHBACK_ADJUSTMENT_SNAPSHOT_CONFLICT` (SQLSTATE `23514`). Como a função executa na mesma transação, os efeitos do estorno são revertidos juntamente com o erro. Estados legítimos de quitação (`open`, `paid`, `waived`) não são modificados pela validação e não afetam a identidade econômica dos ajustes.

## Limites e contexto

A correção conserva as regras de compensação de comissão, devolução do cashback gasto, restauração de créditos pré-pagos, cancelamento de cobrança e exigência de autorização administrativa.

Verificados antes da mudança: nenhum pedido, concessão de recompensa, reversão ou lançamento de carteira na produção. Sem pedidos reais criados no teste e sem chamadas a PSPs.

## Testes

`node tests/financial-reversal-adjustment-integrity-v1-332.mjs` confere o SQL ativo versionado e exercita a comparação das identidades econômicas, incluindo registros idênticos já quitados, divergências de valor, revenda, pedido, direção e tipo. Integra o workflow Audit.

Para validar após a migração: `pg_get_functiondef` com as duas novas guardas, advisors do Supabase, consistência dos registros financeiros e versão de portais. A suíte automatizada **não substitui** homologação de estornos financeiros reais com provedores.
