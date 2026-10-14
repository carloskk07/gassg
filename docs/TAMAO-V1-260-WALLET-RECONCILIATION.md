# TAMÃO V1.260 — Conciliação auditável da carteira e dos benefícios

## Objetivo
Separar três grandezas distintas: **benefícios concedidos**, **créditos usados num pedido efetivamente liquidado** e **pagamentos monetários para fora da plataforma**. Esta versão só comprova os dois primeiros quando há lançamento correspondente; a terceira continua não mensurada, não zerada.

## Fontes de verdade
1. \`order_reward_grants\` — coorte das concessões com \`created_at\` na competência em \`America/Sao_Paulo\`.
2. \`wallet_entries\` — verificação, por \`order_id\`, tipo de evento, valor e destinatário:
   - \`cashback_earn\` deve corresponder exatamente a \`cashback_cents\` do cliente do pedido;
   - \`referral_pending\` deve corresponder exatamente a \`referral_pending_cents\` e ao indicador.
   - ausência, diferença, duplicidade ou usuário divergente entram em *não conciliado*, nunca em concedido comprovado.
3. \`orders\` e \`wallet_entries\` — cashback consumido em pedido que está **atualmente** \`SETTLED\`/\`settled\`, com pagamento confirmado, sem reversão; \`cashback_reserve\` deve ter um lançamento único com valor igual ao crédito reservado e destinatário cliente; qualquer \`cashback_release\` vinculado impede a classificação como uso verificado.
4. \`platform_owner_campaign_order_attributions_v1_252\` — vinculação opcional de concessão por pedido/UTM. Sem atribuição causal. O relatório global inclui pedidos sem UTM; o recorte por campanha contempla até 50 alocações.

## Períodos e prevenção de contagem dupla
- Concessões por data de emissão da recompensa.
- Uso de cashback por mês da liquidação do pedido, olhando toda a vida dos registros de reserva/liberação desse pedido. Um pedido liquidado e posteriormente revertido deixa de contribuir ao uso verificado.
- Eventos de carteira por sua própria data de criação, somente como movimentações: seed, ganho, reserva, liberação, reversão, pendência, maturação e reversão de indicação.
- **Nunca some** concessões, reservas e maturações como se fossem desembolsos adicionais. \`referral_available\` apenas move saldo interno.
- Cashback é saldo *fungível*. Não existe "lote de origem" associado a cada centavo resgatado. V1.260 prova a reserva que abateu o pedido, mas **não** pode alegar qual recompensa anterior financiou aquele gasto. Para isso será necessário implantar rastreabilidade transacional de lotes antes das novas emissões.
- A movimentação \`cashback_seed\` é crédito promocional, não entrada bancária nem despesa paga ao usuário.

## Segurança
- Relatório somente leitura: RPC pública \`public.admin_owner_wallet_reconciliation_v1_260\` executável apenas por \`service_role\`; função privada com autorização explícita de \`superadmin\` ou \`finance\` ativo.
- A Edge \`admin-ops\` confirma o papel e rejeita respostas que não satisfaçam as identidades contábeis. Navegador não possui a chave secreta.
- A interface oculta registros ao mudar de usuário, papel ou competência. Não retorna \`user_id\`, \`order_id\`, nomes ou documentos; apenas agregados.
- Não realiza movimentações de carteira, estornos, saques, pagamentos, alterações de pedidos ou ativações.
- \`externalPaidBenefitsCents\` é **null**, \`externalPayoutMeasured\` é **false**. Lucro, ROI, saldo bancário e causalidade não são calculados.

## Ambiente e entrega
- Migração: \`supabase/migrations/20261014234500_owner_wallet_reconciliation_v1_260.sql\`.
- Edge: \`supabase/functions/admin-ops/index.ts\`.
- Painel: \`js/admin-acquisition.js\`, link em Aquisição → Central de financiamento e crescimento → Resultados; \`js/bootstrap.js\`.
- Teste: \`tests/owner-wallet-reconciliation-v1-260.mjs\` no workflow Audit.

## Limitações
Resultados zerados no mês com base vazia são comportamento válido, mas **não validam o fluxo completo de transações reais**. O teste unitário valida invariantes e falhas; integração com lançamentos reais pode ser exercitada quando houver operações autorizadas. Divergências não são corrigidas automaticamente.

## Próxima melhoria
Criar um modelo de emissão por lotes e uma trilha de pagamento externo, com conciliação por PSP/banco, antes de apresentar rentabilidade efetiva dos incentivos. Evitar alterar retroativamente lançamentos históricos fungíveis.
