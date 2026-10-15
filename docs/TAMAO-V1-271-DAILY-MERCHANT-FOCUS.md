# TAMÃO V1.271 — Resumo diário que ajuda a revenda a trabalhar

## Entrega

- O topo do painel mostra **uma ação prioritária** escolhida entre os pedidos já recebidos do servidor, sem carregar dados de outros comerciantes.
- Se existe oferta com prazo válido e muito próximo, ela recebe prioridade. Quando não, vem imprevisto, nova oferta, entrega aguardando conferência, entrega em andamento e preparação.
- Ofertas vencidas não recebem convite para aceite: o painel pede atualização.
- O botão do resumo só **abre o pedido real**; nunca aceita, recusa, despacha, marca pagamento ou finaliza por conta própria.
- Motoristas veem apenas a lista atribuída pelo backend, sem vendas ou informações de outras revendas.
- Proprietário e gerente podem ver o valor **registrado dos pedidos concluídos em 30 dias** somente com resposta estruturada, segregada e validada da RPC existente. Ausência de resposta ou divergência: nenhum valor é inventado; opção de consultar.
- A fila completa, alertas, contatos protegidos, PIN, confirmações e demais tarefas permanecem disponíveis.

## Invariantes

Sem mutações de banco, pagamentos, transferências, autorizações, novas rotas ou desativação de alertas. Métricas não equivalem a lucro, saldo bancário ou receita do TAMÃO.

## Testes

Regressão dedicada `tests/merchant-daily-focus-v1-271.mjs`, testes de fila da V1.174, atenção da V1.177, negócios da V1.231 e E2E móvel.
