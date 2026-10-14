# TAMÃO V1.252 — atribuição UTM de pedidos concluídos

## Escopo entregue
A V1.251 acompanha interesse e cadastros por links de campanha. A V1.252 complementa isso com um vínculo opcional entre um **pedido real e exatamente uma alocação de campanha**, aplicado pela Edge Function de criação do pedido após a criação idempotente do pedido no serviço oficial.

A campanha precisa ser acessada por link `utm_source=tamao&utm_medium=owner_campaign&utm_campaign=tam-...`. O cliente não informa valor financeiro nem autoriza gastos por esses parâmetros. O servidor valida a origem do pedido pelo usuário autenticado e confere a alocação, a competência, a data de criação e a eventual devolução do orçamento. A vinculação é imutável (chave primária `order_id`) e tem prazo de 10 minutos após a criação do pedido. Um replay da mesma campanha é idempotente; uma segunda campanha não substitui a original.

### Segurança da compra
O pedido continua sendo criado exclusivamente por `create_order_from_quote_v8`, com as verificações financeiras, antifraude e de idempotência existentes. O vínculo de campanha acontece **depois**, por função SQL restrita ao `service_role`. Falha de tracking não altera nem cancela o pedido e não inventa uma confirmação. Nenhuma coluna financeira do pedido é modificada.

### Painel do administrador
Em **Aquisição → Central de financiamento e crescimento → Resultados**, a nova seção **Pedidos ligados à divulgação** permite consultar a competência selecionada e mostra:
- pedidos criados com a UTM validada;
- pedidos em estado `SETTLED` com `financial_state='settled'` e confirmação de pagamento presente;
- liquidações revertidas `financial_state='reversed'`, contadas separadamente;
- valor da compra desses pedidos atualmente liquidados, referente às vendas das **revendas**.

O relatório não devolve identificadores de compradores, telefones, endereços ou IDs dos pedidos. Somente `superadmin` ou `finance` com autenticação conseguem ler a RPC. A tabela de vinculação tem RLS habilitado, sem grants diretos para clientes.

## Limitações de negócio
**Origem UTM não prova que a campanha causou a compra**. Um código válido no checkout apenas associa o pedido ao último identificador observado naquela URL (sem persistência adicional entre sessões). A V1.252 não afirma causalidade, retorno incremental, custo desembolsado, receita de taxa recebida, lucratividade ou ROI.

Pagamento de cliente à revenda (inclusive declaração da revenda) não é necessariamente recebimento de taxa pelo TAMÃO. O valor da venda da revenda nunca é chamado de receita da plataforma. Estornos deixam de compor os valores liquidados correntes. Valores históricos de campanhas podem ser revistos conforme a liquidação do pedido.

## Publicação
- Migração: `supabase/migrations/20261014180000_owner_campaign_order_attribution_v1_252.sql`.
- Edge Functions: `create-order` e `admin-ops`; preservar `verify_jwt` e dependências existentes.
- Frontend: `js/backend.js`, `js/admin-acquisition.js` e export da função administrativa no `js/bootstrap.js`.
- Regressão: `node tests/owner-campaign-orders-v1-252.mjs`, demais testes Audit, build e prontidão.
- Sem pedidos no banco no momento da implementação, validação de integração com pedidos de verdade depende de atividade real autorizada; não criar transações fictícias em produção.

## Próxima etapa
Criar relacionamento auditável entre a taxa de plataforma efetivamente recebida e um pedido específico. Somente então considerar indicadores financeiros de campanhas e, quando houver custos pagos, calcular retorno sobre investimento.
