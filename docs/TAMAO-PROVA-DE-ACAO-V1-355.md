# TAMÃO V1.355 — Prova de validade no instante da ação operacional

## Problema concreto
A V1.354 já substituía visualmente a fila quando a leitura do servidor tinha mais de dois minutos. Entretanto, o operador pode manter um cartão antigo renderizado sem uma nova chamada de `render()`; quando clicar nele depois que a janela de validade passou, o código cliente ainda poderia transmitir um comando até que o backend finalmente o rejeitasse. Isso também vale para uma aba cujo usuário trocou de revenda sem que o cartão anterior fosse removido.

## Correção
O cliente valida novamente, no próprio instante da ação, **antes de criar qualquer requisição mutável**:
- Sessão da revenda no estado `ready`, com identidade efetiva e seleção de revenda compatíveis.
- `merchant-orders` aceito há até 120 segundos, sem horário impossível (mais de 60 segundos no futuro).
- Pedido presente na lista desta revenda.
- Para `accept` e `reject`, estado `OFFERED_TO_MERCHANT` e `offerExpiresAt` ISO válido, com mais de 1 segundo de validade restante.
- O mecanismo está em `merchantVerifiedActionOrder()` e protege `merchantPerformAction()`, `merchantAssignDeliveryLive()` e `merchantCompleteDeliveryLive()`.

Se qualquer prova falhar, a ação é interrompida com mensagem para atualizar os pedidos. Nenhum `merchant-action` ou `complete-delivery` é enviado nesse caso.

## Proteções mantidas
- O usuário **continua decidindo** se aceita/recusa, sai para entregar, atribui um responsável ou confirma recebimento e PIN.
- O servidor segue como autoridade e continua validando status, versão esperada, identidade, permissões e regras de pagamento/entrega. O guard local é defesa adicional, não substituto de autorização.
- Nenhuma autorização comercial, preço, estoque, cadastro, banco, Edge Function, perfil, pagamento, crédito ou cidade é alterado.
- O mecanismo de reconhecimento do resultado de uma mutação e a posterior atualização da fila (V1.330) permanecem separados: uma leitura posterior malsucedida não apaga a prova de que a mutação foi aceita pelo servidor.

## Validação
- `tests/merchant-action-proof-v1-355.mjs`: prova ausente, vencida, futura, revenda trocada, pedido ausente, janela inválida/vencida; bloqueio sem RPC de aceite, despacho, atribuição ou entrega; execução legítima preservando `expectedVersion`.
- Atualização de `tests/merchant-mutation-refresh-proof.mjs` com uma situação válida e recentemente consultada; continuam os testes de resposta ambígua, double click, atualização descartada, PIN e indisponibilidade.
- `Audit`, `Build isolated live portals`, `TAMÃO launch readiness`, `TAMÃO Cloudflare official production deploy` e reconciliação deverão passar.

## Limites
Ainda são necessários testes reais com revendas autenticadas e em conexão intermitente para comprovar o impacto na operação. Esta atualização não mede tempo de aceite nem ganhos de conversão.
