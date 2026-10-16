# TAMÃO V1.330 — Auditoria de confirmação de ações da revenda

Data: 16/10/2026.

## Defeito localizado

Em `js/backend.js`, após uma chamada `merchant-action` ou `complete-delivery` retornar com sucesso, o frontend aguardava `merchantRefresh({silent:true})` **dentro do mesmo bloco try/catch**. Uma queda da rede nessa segunda chamada fazia a interface lançar exceção na camada de ação, apesar da operação anterior já poder estar gravada no banco. Isso ocorria em:
- Aceitar, recusar, despachar, informar chegada, registrar impossibilidade de atendimento.
- Atribuir entregador.
- Concluir entrega com PIN.

O erro era de **interpretação no frontend**, não uma prova de escrita incorreta no banco.

## Correção

O helper `merchantRefreshAfterConfirmedMutation` diferencia o comprovante da ação (resposta HTTP positiva ao RPC) da leitura posterior dos pedidos. Se essa leitura não for aceita, a tela entra em estado indisponível e descarta a lista anterior de pedidos, evitando botões de aceite/saída/entrega sobre snapshots antigos. A confirmação HTTP da ação continua sendo retornada.

A validação também exige que a resposta da atualização seja **exatamente o snapshot aplicado ao painel**. Atualizações de consultas simultâneas podem ser descartadas por `refreshSeq`; uma resposta descartada não pode revalidar os controles antigos.

Importante: erros ou respostas de rede ambíguas **na mutação original** continuam sendo erros. O código não cria uma confirmação sem retorno do servidor. Repetições de uma tentativa dentro de `retryAmbiguousOnce` mantêm a mesma chave idempotente.

## Regresso automatizado

`node tests/merchant-mutation-refresh-proof.mjs` cobre:
- Cinco ações de pedido com mutação bem-sucedida e leitura posterior falhando.
- Atribuição do responsável pela entrega.
- PIN de recebimento correto, incorreto e bloqueado.
- Resposta desconhecida da chamada de mutação.
- Atualização bem-sucedida versus snapshot descartado por consulta concorrente.
- Perda de acesso à revenda.
- Dois cliques durante uma ação pendente.

A suíte está integrada ao workflow Audit do GitHub.

## Escopo preservado

Não altera migrations, Edge Functions, ações de banco, regras financeiras, autenticação, reservas ou integridade de PIN. Não cria pedidos, notificações ou pagamentos. Nenhuma cidade é ativada.

## Limite de validação

Testes por mocks e workflows automatizados não comprovam compra física, checkout de provedor, aceite/entrega reais ou notificações push. O ensaio operacional permanece necessário antes da abertura controlada.
