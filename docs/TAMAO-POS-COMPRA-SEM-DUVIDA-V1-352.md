# TAMÃO V1.352 — Próximo passo após o pedido, baseado em fatos reais

## Diagnóstico
O acompanhamento do pedido já possui status server-side, eventos e proteção de informações sensíveis, porém "O que fazer agora" era apenas uma frase. O cliente precisava procurar, em outras partes da página, os controles para rever uma proposta, atualizar um pedido ou solicitar ajuda. Além disso, `lastSyncAt` se refere à sincronização geral da sessão (incluindo consulta de ofertas e dados financeiros) e não comprova sozinho que o pedido foi realmente consultado.

## Implementação
1. **Confirmação específica da leitura de pedido**: o runtime público registra `orderCheckedAt` e `orderCheckedId` **somente após receber e aceitar** uma resposta de `get-order`; não atualiza essa prova com resultados de preços, pagamentos ou outras operações. Respostas antigas descartadas não renovam o horário.
2. **Próxima ação em destaque**: o quadro do pedido apresenta um botão contextual, sempre apontando a uma função de consulta já existente ou a uma âncora real na mesma página.
   - Pedido oferecido ou em reavaliação: consultar andamento.
   - Reproposta vigente: conferir o quadro de valores anterior e novo; não autoriza nada automaticamente.
   - Reproposta vencida: atualizar e não oferecer aprovação direta no atalho.
   - Imprevisto: acessar suporte vinculado ao pedido.
   - Em entrega: encontrar as orientações do código, quando a resposta oficial informou um código, ou o histórico.
   - Pedido concluído ou encerrado: avaliar, consultar ou registrar atendimento.
3. **Prova de atualização**: a página diferencia uma leitura recente (menos de três minutos), antiga, sem horário confirmado e falha de atualização. Dado antigo exige consulta antes de propor atalhos de decisão, e dados de outro pedido não servem como comprovação deste.
4. **Acessibilidade**: ações com tamanho confortável para toque, `focus-visible`, âncoras reais com `scroll-margin-top`, desenho vertical em celular, sem movimentos obrigatórios.

## Invariantes
- Nenhuma ação administrativa, autorização de cidade, edição de catálogo, preço, estoque, cobrança, cashback, saldo ou política financeira foi modificada.
- As ações de pedido e a validade de uma proposta continuam validadas pelo servidor. O atalho de aprovação apenas leva ao quadro existente; não chama `confirmRequote`.
- Código de recebimento só é mostrado em `OUT_FOR_DELIVERY` ou `ARRIVING` quando retornado pelo servidor. Não é exibido em estados anteriores, depois de entregue ou ao cancelar.
- Status de pagamento, reembolso, aceite de revenda e entrega permanecem somente os que o backend confirma. Consultas antigas não são apresentadas como estado ao vivo.

## Verificações
- `tests/buyer-tracking-action-v1-352.mjs`: estado real e recente, estado antigo, prova incompatível com outro pedido, erro, reproposta vigente/vencida, botões somente de consulta/navegação, ausência de PIN indevido, HTML de atendimento e mobilidade.
- Preservar regressões `tests/customer-tracking-confidence-v1-164.mjs`, `tests/customer-incident-tracking-v1-179.mjs`, checkout/payment regressions e navegador de 320/360/390px.
- Publicação somente após aprovação de Audit, Build isolated live portals, launch readiness, Cloudflare deploy e reconcile.

## Fora do escopo
Avaliação humana autenticada em aparelho real, métricas de uso/conversão, campanhas de marketing e qualquer comprovação de operação comercial de uma cidade. Não há alegação de aumento de conversão sem evidência.
