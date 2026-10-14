# Clube TAMÃO V1.239 — rascunhos e simulação econômica
Data: 13/10/2026. Estado: **simulador administrativo, sem vendas**.

## Contrato financeiro
- Pacotes **hipotéticos**, ainda sem oferta pública, pagamento, emissão de créditos ou cupom.
- Gás: R$ 8,90 / 3 cupons de R$ 5 / 180 dias / pedido mínimo R$ 100.
- Água: R$ 4,90 / 5 cupons de R$ 2 / 90 dias / pedido mínimo R$ 30.
- O pacote Família fica fora desta primeira etapa, porque mistura categorias e obrigações diferentes.
- A revenda não é obrigada a participar. Marca e revenda só financiam campanhas com contrato, limite de verba e cidade/categoria expressos. A prévia **não** verifica patrocínio.
- Pagamento de produtos continua **direto à revenda**. Pacotes seriam cobrados separadamente pelo TAMÃO em uma fase posterior, sob cobrança regularizada. Não existe split.
- A base da comissão ilustrativa da plataforma é o pedido **depois do desconto**. A modelagem não altera a política comercial efetiva.
- Para evitar inflar receita, o primeiro resultado considera **zero novos pedidos atribuídos** aos cupons. O segundo supõe todos os pedidos incrementais, sendo explicitamente **não uma previsão**.
- O custo do pacote tem abatimento por tarifa de aquisição. Cashback, indicação, custos variáveis e reserva de contribuição são deduzidos em **cada pedido**.
- Se um cenário mostrar prejuízo, não é aprovação: a ativação está bloqueada de toda forma. Resultado positivo no cenário conservador não prova demanda, adesão, elegibilidade ou lucro fiscal.

## Controle e proteção
- Tabela `clube_package_drafts_v1_239` contém apenas duas condições ilustrativas fixas e com `sales_enabled = false`, `redemption_enabled = false` por CHECK.
- RLS habilitada, nenhuma política pública e nenhum GRANT a `anon` ou `authenticated`. `service_role` só tem leitura.
- RPC pública `admin_clube_coupon_preview_v1_239` exposta somente a `service_role`. Rotina interna em schema não exposto valida `platform_admins.active` e papel `finance`/`superadmin`.
- A Edge `admin-ops` autentica, valida papel, inteiros, formato, cenário e retorno. A página Financeiro → Regras e reversões oferece simulação e nenhum botão de compra, emissão ou resgate.
- Não se altera `orders`, `merchant_fee_credit_ledger`, `merchant_daily_statements`, cashback, programa de indicação ou PSPs. Não há alteração de preço do item no checkout.

## Caminho de liberação futura
1. Colher interesse voluntário das revendas, vinculando CNPJ verificado, categoria, cidade, percentual financiado, limite monetário e aceite versionado.
2. Revisão jurídica/fiscal da venda de direito de desconto, CDC/arrependimento, prazo, privacidade e reembolsos; incluir obrigações não utilizadas no passivo do TAMÃO.
3. Instituir orçamento por patrocinador e prova de fundos; impedir vender pacotes sem capacidade de utilização na cidade.
4. Implementar emissão transacional pós-confirmação de pagamento, bloqueio de compras simultâneas, reservas atômicas de cupom, resgate liquidado, cancelamento e estorno.
5. Proibir resgate fora da revenda/categoria conveniada ou sobre pedidos que gerem margem negativa sem autorização.
6. Homologar pagamento, conciliação, idempotência e antifraude em ambiente controlado; ativar somente mediante decisão explícita do Admin e nova migração. Publicar termos e preços reais antes de abrir vendas.

## Cenários para auditoria
- Gás, revenda cobre 100%: R$ 8,90 - R$ 1,50 tarifa - 3 × R$ 0,90 custos = **R$ 4,70** no cenário sem pedidos incrementais e sem outras despesas. É apenas simulação.
- Gás, TAMÃO cobre 100%: R$ 8,90 - R$ 1,50 - R$ 15,00 cupons - R$ 2,70 custos = **−R$ 10,30**, mesmo antes de outros gastos.
- Água, revenda cobre 100%, tarifa R$ 1,50 + custos R$ 0,90/pedido: **−R$ 1,10** no cenário conservador.
- Todos os preços, taxas, custos e índices devem ser calibrados com dados reais antes de ofertar qualquer benefício.

## Comprovação esperada
Audit CI `node tests/clube-finance-preview-v1-239.mjs`; PostgreSQL: ACL `has_table_privilege` e `has_function_privilege`, papéis sem autorização com SQLSTATE 42501, ensaios read-only de cenários; monitorar integridade da função `admin-ops` e confirmar publicação separadamente. Nenhum dado fictício de revenda ou faturamento deve ser criado para a demonstração.
