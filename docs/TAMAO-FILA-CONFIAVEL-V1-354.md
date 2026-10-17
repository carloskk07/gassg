# TAMÃO V1.354 — Fila de pedidos com leitura recente e recuperação segura

## Problema
A fila da revenda mostra pedidos autorizados pelo servidor, e as ações finais já são protegidas com versão de pedido e validação no backend. Contudo, após a última consulta ficar antiga, a página ainda poderia exibir ações de aceite, saída e recebimento sem informar ao operador que estava usando uma lista não atualizada. Isso é especialmente confuso em conexão intermitente e em abas abertas por longos períodos.

## Alterações
- O novo `merchantOrderListEvidence(rt,now)` identifica uma consulta confirmada há até 2 minutos, uma lista antiga, horário não comprovado ou seleção de revenda incompatível. Usa o `lastSyncAt` já escrito somente após resposta aceita do endpoint `merchant-orders`, e não o heartbeat da loja, notificações push ou consulta financeira.
- A página da revenda e a visão do motorista continuam mostrando informações gerais, mas substituem as filas operacionais e atalhos que dependem dos pedidos por uma explicação e botão **Atualizar pedidos** quando o retrato não está comprovadamente recente. O número de pedidos antigos, quando disponível, é identificado como pertencente à última lista, e não como fila atual.
- Dados de outras revendas nunca são usados como prova; quando a seleção da revenda e a identidade do resultado não coincidirem, a atualização volta a ser exigida.
- O atalho de orientação no cabeçalho da revenda aponta para a recuperação da fila, não para uma execução automática de aceite ou despacho.
- Mensagens de recuperação e controles são legíveis no celular, com foco de teclado e movimento reduzido.

## Restrições e segurança
- Nada é automaticamente aceito, rejeitado, despachado, entregue ou pago. A atualização lê novamente a lista e não altera pedidos.
- A validação final do servidor permanece obrigatória, inclusive `expectedVersion` e idempotência. O controle visual não substitui os controles de backend.
- O estado de conexão não comprova aceite de pedido, estoque, dinheiro, entrega ou prontidão para vender.
- Sem alterações em SQL, tabelas, RLS, Edge Functions, cidades, papéis de revenda, preços, saldos ou mecanismos de pagamento.
- Temporariamente, uma lista com mais de dois minutos pode exigir um clique em Atualizar, intencionalmente, para evitar operar com um retrato antigo. Consultas automáticas já atualizam a marca de leitura quando recebem resposta válida.

## Verificações
`tests/merchant-freshness-v1-354.mjs` testa leitura recente, vencida, ausente, futura, pertencente a outra revenda, aviso de recuperação, bloqueio dos controles da fila do motorista, acessibilidade e contrato de atualização após a leitura do servidor.

A versão só poderá ser chamada de publicada após auditoria automatizada, build dos três portais, prontidão operacional, publicação oficial Cloudflare e reconciliação da entrega.

Inspeção manual com revendas autenticadas e métricas de tempo de atendimento continuam necessárias para validar o ganho real de uso.
