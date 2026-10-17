# TAMÃO V1.357 — Ação registrada x fila atualizada

## Diagnóstico
Desde a V1.330, uma operação da revenda pode ser confirmada pelo servidor mesmo quando uma consulta posterior da lista `merchant-orders` falha. O sistema então bloqueia corretamente a lista até a reconexão. No entanto, as mensagens breves do painel podiam indicar apenas **“Pedido aceito”**, **“Entrega e pagamento confirmados”** ou **“Responsável confirmado”**, sem informar que os pedidos exibidos ainda precisavam ser reconferidos.

Esse detalhe é especialmente importante para revendas em celulares e conexões intermitentes: a resposta à operação e o estado da fila atualizada são duas evidências distintas.

## Correção
- `merchantPostActionConfirmation` centraliza o texto exibido após uma resposta de operação concluída.
- Quando a consulta posterior falhou e o painel entrou em `unavailable`, `no-access` ou `unauthenticated`, a mensagem não sugere que a lista foi atualizada: **“O servidor respondeu à ação, mas não conseguimos reconferir a fila. Atualize os pedidos antes de continuar.”**
- Se a consulta posterior foi aceita, permanecem as mensagens usuais e objetivas de aceite, recusa, saída, chegada, impossibilidade, atribuição e entrega.
- O comportamento de redirecionamento automático após expiração/indisponibilidade da oferta permanece específico e não é tratado como aceite.
- Quando a própria operação falha ou tem resposta ambígua, continua sendo apresentada a falha: não há mensagem de sucesso.

## Limites e controles
- Nenhuma autorização, transição ou resultado financeiro foi criado pela mensagem.
- A confirmação final do servidor, a versão do pedido, a validação de PIN, a política de pagamento e a proteção contra cliques duplicados permanecem obrigatórias.
- A tela já bloqueia ações e apresenta opção de atualizar quando a reconciliação falha. A V1.357 melhora apenas a fidelidade da informação de retorno.
- Nenhuma mudança em Supabase, Edge Functions, RLS, cidades, PSP, preços, pedidos, estoque ou outros dados persistidos.

## Validação
- `tests/merchant-post-action-feedback-v1-357.mjs` cobre as mensagens após resposta normal, falha de reconciliação, perda de acesso, aceite, recusa, saída, chegada, impossibilidade, atribuição, entrega, tratamento de falha e bloqueio de concorrência.
- `.github/workflows/audit.yml` passa a executar o teste.
- Preservados os testes de prova e transição `merchant-mutation-refresh-proof.mjs`, `merchant-action-proof-v1-355.mjs`, `merchant-action-stage-gates-v1-356.mjs`, além dos smoke tests e E2E móveis.

A aprovação automatizada não substitui teste manual autenticado numa conexão realmente instável. Publicação sujeita aos workflows oficiais de auditoria, build, prontidão e Cloudflare/reconciliação.
