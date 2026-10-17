# TAMÃO V1.359 — Resultado real da ação da revenda

## Problema confirmado
A função SQL de saída para entrega pode retornar `dispatched:false` e `autoRescued:true` quando a operação não pode continuar (por exemplo, capacidade de entrega ou conformidade operacional alterada). A interface `merchantLiveAction` interpretava a reavaliação apenas no caso de aceite; no despacho ela apresentava **"Saída confirmada"** mesmo quando o servidor havia indicado que nenhum despacho aconteceu.

Na V1.358 foi implantada uma verificação de resposta negativa/vazia, mas objetos `{}`, listas `[]`, `0` e strings ainda podiam passar como confirmação não negativa, mesmo sem conteúdo que comprovasse a operação.

## Correções
1. A interface interpreta `autoRescued:true` para **todas** as ações operacionais, antes de escolher a mensagem de sucesso. Para saída, informa claramente que não foi confirmada e orienta consultar o pedido reavaliado; não gera uma segunda mutação.
2. A confirmação RPC no cliente exige um **objeto estruturado** com evidência positiva:
   - `ok:true` ou `success:true`, quando presente;
   - resposta SQL legada com `orderId` UUID válido, `version` inteiro positivo e `status` não vazio;
   - `autoRescued:true`, preservando o fluxo de reavaliação comprovado pelo servidor.
3. Respostas nulas, primitivas, listas, objeto sem evidência positiva, `ok:false`, `success:false` ou erro explícito não autorizam confirmação visual. O cliente continua oferecendo consulta da fila antes de repetir decisões.
4. Os bloqueios de autorização, etapa, versão, idempotência e aceite de pagamento/código de entrega permanecem inalterados.

## Prova e testes
`tests/merchant-outcome-proof-v1-359.mjs` cobre 16 formatos de resposta, incluindo o resultado SQL `dispatched:false,autoRescued:true`, o caso de aceite reavaliado, saída confirmada legítima e ausência de uma segunda ação durante a interpretação. O teste foi registrado na auditoria GitHub Actions.

Regressões V1.354–V1.358, testes de navegação 320/360/390 px, construção dos portais, pronto para lançamento, deploy Cloudflare e reconciliação seguem obrigatórios.

## Escopo
Sem alterações em Edge Functions, Supabase, pagamentos, banco, permissões, liberação de cidades ou estados reais de pedidos. Corrige somente a interpretação do resultado e sua apresentação; não reivindica operação comercial de revendas ou benefício financeiro comprovado.
