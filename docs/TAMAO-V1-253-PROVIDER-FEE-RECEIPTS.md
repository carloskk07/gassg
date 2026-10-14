# TAMÃO V1.253 — Taxas da plataforma comprovadas por provedor, sem rateio

## Objetivo
A nova seção de **Resultados → Taxas recebidas com comprovação individual** mostra valores das taxas do TAMÃO atribuíveis a pedidos de campanhas **somente quando há rastreabilidade integral** entre pedido, crédito a receber, extrato diário e pagamento conciliado com evento de PSP. É uma medição conservadora, que não infere saldo bancário nem retorno sobre investimento.

## Fonte de verdade
- V1.252 `platform_owner_campaign_order_attributions_v1_252`: uma campanha atribuída imutavelmente a um pedido.
- `orders`: pedido liquidado, com `financial_state='settled'`, status `SETTLED` e confirmação de pagamento, sem reversão ativa.
- `platform_receivables`: taxa real por pedido, com `status='paid'`, mesma revenda e sem uso de créditos pré-pagos.
- `merchant_daily_statements`: extrato diário pago e resolvido por pagamento, cuja única conta a receber pertence **exclusivamente ao pedido em questão**. Totais do extrato devem ser idênticos à taxa.
- `merchant_billing_payment_requests`: uma única cobrança aprovada do tipo `statement_payment`, de valor exato, com origem `provider_event`.
- `merchant_billing_payment_events`: evento do PSP aplicado, correspondente em valor, revenda e cobrança.
- `merchant_billing_payment_refunds`: nenhum estorno vinculado à cobrança ou evento. Também exclui pedidos com ajuste de restituição de taxa.

## O que os números significam
Exibe por campanha **taxas confirmadas por evento do provedor**, quantidade de pedidos assim comprovados e quantidade de pedidos atribuídos **sem comprovação individual suficiente**. Uma cobrança diária que reúne dois ou mais pedidos **não pode** ser distribuída entre eles por aproximação; ela é totalmente excluída da receita atribuída da V1.253.

Uma aprovação manual, crédito pré-pago, cobrança sem comprovante de PSP, extrato não pago, estorno ou pagamento em lote não entra no valor confirmado. Assim, os números podem ser deliberadamente menores que os recebimentos totais da plataforma. Ausência de prova *não* é ausência de pagamento.

**Evento PSP aplicado não comprova liquidação bancária final.** O sistema não afirma saldo bancário disponível, margem líquida, lucro, custo desembolsado de marketing, causalidade da campanha ou ROI. Nenhuma taxa, pagamento, repasse, bônus ou crédito é criado por esta consulta.

## Controle de acesso
RPC com lógica em esquema privado e autorização ativa de `superadmin`/`finance`. Wrapper público permite executar somente com `service_role`. Edge `admin-ops` exige sessão e repete as validações contratuais. Frontend isola os dados por sessão e não apresenta retornos incompletos como confirmados.

## Implementação e testes
- `supabase/migrations/20261014190000_owner_campaign_fee_receipts_v1_253.sql`
- `supabase/functions/admin-ops/index.ts`
- `js/admin-acquisition.js`, `js/bootstrap.js`
- `tests/owner-campaign-fee-receipts-v1-253.mjs` e suíte Audit

## Evolução necessária para ampla cobertura
Para atribuir receita de extratos diários com várias vendas ou de planos pré-pagos, criar **um livro-razão individual de aplicação de recebimentos por pedido**, fundamentado em comprovantes PSP e com reversões explícitas. Sem ele não se calcula ROI, mesmo que haja cliques e compras atribuídas.
