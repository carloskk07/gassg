# TAMÃO V1.360 — Resultados contraditórios não confirmam operações

## Lacuna diagnosticada
A V1.359 exige prova positiva para tratar uma resposta como confirmação. Entretanto, uma resposta contendo `ok:true` junto de `dispatched:false` ainda podia ser aceita porque a confirmação positiva genérica tinha precedência. O resultado da tela poderia ser **“Saída confirmada”** mesmo com evidência explícita de que a saída não ocorreu.

Também faltava conferir que um identificador de pedido retornado na resposta (quando presente) se referia ao pedido efetivamente acionado, não a outro pedido.

## Correções
- `merchantRefreshAfterConfirmedMutation(reply, context)` mantém todos os critérios positivos da V1.359 e exige adicionalmente que o conteúdo não se contradiga:
  - `accept` não pode ter `accepted:false` sem resgate verdadeiro;
  - `dispatch` não pode ter `dispatched:false` sem resgate verdadeiro;
  - `arriving`, `complete-delivery` e `assign-delivery` não podem apresentar seus indicadores negativos de resultado;
  - uma confirmação `autoRescued:true` não pode se misturar a marcadores incompatíveis como `accepted:true` ou `dispatched:true`;
  - quando a resposta informa `orderId`, ele precisa ser um UUID válido e corresponder ao pedido acionado.
- Os três fluxos operacionais (`merchantPerformAction`, `merchantAssignDeliveryLive`, `merchantCompleteDeliveryLive`) fornecem ação e identificador do pedido ao verificador, sem criar uma nova mutação ou qualquer escrita.
- Quando há evidência contraditória, o cliente não mostra confirmação positiva. Orienta a consultar a fila antes de tentar novamente e preserva a proteção de tentativas/idempotência já existente.
- O redirecionamento automático comprovado pelo servidor, incluindo o despacho que **não aconteceu**, continua com mensagem própria da V1.359.

## Invariantes
Não houve modificação em SQL, Supabase, Edge Functions, RLS, PSP, pagamentos, cidades, estoque, taxa, comissão, código de entrega ou permissões. Uma resposta inconclusiva não prova que a ação falhou; a decisão segura é reconferir a fila, não executar novamente automaticamente.

## Verificação
`tests/merchant-contradictory-outcome-v1-360.mjs` cobre respostas afirmativas/negativas misturadas, identificadores de outros pedidos, respostas legadas coerentes, rejeição válida e resgate automático. Regressões V1.354–V1.359 continuam obrigatórias, junto da auditoria, build dos três portais, testes de navegador móvel, prontidão e publicação/reconciliação Cloudflare.

A aprovação dos testes não substitui homologação operacional manual com uma revenda autorizada.
