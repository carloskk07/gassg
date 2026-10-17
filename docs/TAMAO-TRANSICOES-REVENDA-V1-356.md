# TAMÃO V1.356 — Transições de pedidos verificadas antes do comando

## Diagnóstico
A V1.355 já confere a identidade da revenda, o vínculo com a fila e a validade do aceite no instante do clique. Entretanto, nas outras operações do pedido, uma aba antiga poderia enviar uma ação para uma etapa que já não era compatível — por exemplo, tentar informar chegada enquanto o pedido ainda estava em preparação, concluir entrega antes da chegada ou atribuir um responsável após a saída. O servidor recusaria a transição, mas um comando indevido ainda seria enviado.

## Correção
O cliente agora confere o estado do pedido imediatamente antes de enviar qualquer operação mutável, com uma matriz de etapas específicas:

| Operação | Etapas aceitas |
| --- | --- |
| Aceitar / não consigo atender (oferta) | `OFFERED_TO_MERCHANT`, com prazo válido e mais de um segundo |
| Confirmar saída (`dispatch`) | `PREPARING`, `AT_RISK` |
| Informar chegada (`arriving`) | `OUT_FOR_DELIVERY` |
| Informar impossibilidade (`cannot-fulfill`) | `PREPARING`, `AT_RISK` |
| Atribuir responsável (`assign-delivery`) | `PREPARING`, `AT_RISK` |
| Concluir entrega com PIN (`complete-delivery`) | `ARRIVING` |

A mesma proteção exige uma versão positiva e inteira do pedido. Ao receber um estado incompatível ou uma versão não comprovada, a ação falha antes de chamar o servidor e orienta a atualizar a fila. A verificação atual da identidade, idade da leitura da fila, validade do aceite e controle contra cliques repetidos permanece intacta.

## Invariantes
- O servidor continua como autoridade final; mantém autenticação, papéis, idempotência, `expectedVersion`, verificação de estoque, pagamento e PIN.
- A interface não aceita pedidos, não aciona motorista, não registra pagamento e não avança o status automaticamente.
- Nenhuma alteração no Supabase, SQL, RLS, Edge Functions, autorização comercial de cidades, estoque, preços, benefícios ou pagamentos.
- As transições legítimas não mudam e cada resultado realmente confirmado mantém o fluxo de atualização e proteção contra leituras ambíguas da V1.330.

## Testes
- `tests/merchant-action-stage-gates-v1-356.mjs` percorre estados incompatíveis para seis tipos de operação, versão inválida, nenhuma RPC indevida, transições permitidas, versão transmitida intacta e preservação das confirmações.
- Atualizações em `tests/merchant-action-proof-v1-355.mjs` e `tests/merchant-mutation-refresh-proof.mjs` adaptam a simulação para cada estado realmente permitido sem enfraquecer seus testes de falha, reconsulta, double click e PIN.
- Publicação condicionada a Audit, Build isolated live portals, launch readiness, deploy e reconcile.

## Limites
A proteção cliente reduz pedidos inválidos enviados, mas não substitui prova real de desempenho nem testes manuais com revendas autenticadas em conexões intermitentes.
