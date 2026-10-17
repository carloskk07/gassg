# TAMÃO V1.361 — Coerência das respostas de ações da revenda

## Risco identificado
Até V1.360 a interface rejeitava respostas vazias, IDs divergentes, marcadores negativos e resgates com confirmação contraditória. Entretanto, uma resposta com `ok:true` e **`status:'PREPARING'` após o operador clicar em `Confirmar saída`** ainda podia passar como confirmação, mesmo informando que o pedido não saiu da preparação. Da mesma forma, `arriving` não pode declarar entrega concluída, `complete-delivery` não pode continuar em `ARRIVING` e `accept` não pode concluir em `CANCELLED`.

## Correção
`merchantRefreshAfterConfirmedMutation` mantém a verificação de identidade, marcadores explícitos e erros. Quando o RPC informa `status`, o campo precisa ser compatível com a ação:

| Ação | Status aceitáveis no retorno positivo |
|---|---|
| accept | MERCHANT_ACCEPTED, PREPARING |
| reject | OFFERED_TO_MERCHANT, REASSIGNING, REQUOTE_REQUIRED, CANCELLED |
| dispatch | OUT_FOR_DELIVERY |
| arriving | ARRIVING |
| complete-delivery | DELIVERED, SETTLED |
| cannot-fulfill | REASSIGNING, OFFERED_TO_MERCHANT, REQUOTE_REQUIRED, CANCELLED |
| assign-delivery | PREPARING, AT_RISK |

A compatibilidade é aplicada **somente quando o servidor devolve a propriedade status**. Respostas antigas com `ok:true` sem esse campo preservam o comportamento prévio, com reconciliação obrigatória da fila. Resgates automáticos confirmados continuam sendo tratados como resultado próprio: não se anuncia aceite ou saída.

Se a resposta for contraditória, o sistema não apresenta confirmação positiva. A operação existente recupera os dados após erro, conforme controles anteriores, antes de nova tentativa.

## Proteções preservadas
- Nenhuma mudança nas SQL, Edge Functions, permissões, dados de cidade, preços, estoque, meios de pagamento e regras comerciais.
- Nunca criar pedidos ou despachar automaticamente.
- Aceite, recusa, saída, chegada, atribuição e entrega permanecem sujeitos à versão e transição autorizada do servidor.
- A validação de status é uma proteção adicional, não uma substituição da autoridade do banco.

## Testes
`tests/merchant-action-state-coherence-v1-361.mjs` verifica 32 cenários de resultado, incluindo status coerente, incoerente, vazio, legado, outro pedido, resgate e provas positivas/negativas. Mantém as regressões V1.355–V1.360.

A liberação requer Audit, Build isolated live portals, launch readiness, Cloudflare production deploy e native delivery reconcile em sucesso. Verificação visual autenticada e observação de pedidos reais permanecem etapas separadas de CI.
