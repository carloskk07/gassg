# TAMÃO V1.358 — Confirmação de ações somente com resposta válida

## Falha corrigida
As ações de pedido da revenda eram protegidas por sessão, seleção de revenda, idade do retrato de pedidos, versão do pedido e regras no servidor. A V1.357 já diferenciava um comando respondido de uma fila não atualizada. Ainda havia um caso de ambiguidade: após HTTP 200, a confirmação de algumas ações podia seguir mesmo quando o corpo da resposta fosse vazio (`null`, `false`) ou contivesse rejeição explícita (`ok:false`, `success:false`, ou `error`). O painel poderia mostrar “Pedido aceito”, “Saída confirmada”, “Responsável confirmado” ou “Entrega e pagamento confirmados” sem evidência suficiente.

## Alteração
- `merchantRefreshAfterConfirmedMutation(reply)` verifica **a resposta real da mutação antes de tratar a atualização da fila como pós-confirmação**.
- Respostas negativas, vazias ou com erro explícito não recebem mensagem de ação concluída; apresentam a orientação: **“O servidor não confirmou esta ação. Confira os pedidos atualizados antes de tentar novamente.”**
- Proteção compartilhada por aceite/recusa, saída/chegada, impossibilidade operacional, atribuição da equipe e conclusão com PIN/pagamento.
- Erros específicos de PIN incorreto/bloqueado continuam prioritários e não são alterados.
- Uma resposta positiva do servidor continua válida mesmo se a consulta posterior da fila falhar; neste caso a fila permanece bloqueada até ser reconferida (regra V1.330/V1.357).
- Respostas explícitas de redirecionamento automático continuam sendo sinalizadas como redirecionamento, sem anunciar aceite.

## Limites de segurança
- Nenhuma operação é realizada pelo novo verificador, e ele não desencadeia reenvios de mutação.
- Uma resposta inconclusiva **não comprova que a ação não ocorreu**. Por isso a orientação é consultar o estado atual antes de repetir. A camada existente de idempotência e `expectedVersion` continua necessária.
- Banco, Edge Functions, RLS, permissões, cidades, limites, preços, PSP, saldo, cashback e outras regras comerciais não foram modificados.
- Nenhuma mudança é aplicada automaticamente à operação real durante a auditoria.

## Critérios de aceite
- Teste `tests/merchant-acknowledgement-integrity-v1-358.mjs` cobre respostas vazias/negativas e com erro explícito, as três famílias de mutação, confirmação positiva, falha posterior de leitura, PIN bloqueado, redirecionamento automático e estado `actionPending`.
- Preservar regressões V1.330/V1.355/V1.356/V1.357, CI completa, build dos três portais e verificações Cloudflare de publicação e reconciliação.
- A homologação operacional manual com uma revenda conectada ainda deve testar a perda de conectividade no instante da resposta da ação, sem inventar uma transação real.
