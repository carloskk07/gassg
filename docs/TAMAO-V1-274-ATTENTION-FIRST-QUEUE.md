# TAMÃO V1.274 — Atenção primeiro, sem perder pedidos

## Mudanças na operação da revenda

- O quadro **Pedidos que precisam de atenção** mostra separadamente imprevistos, previsões registradas ultrapassadas e prazos próximos, ordenando pedidos de mesmo nível pelo prazo registrado. São sinais de revisão, não confirmação de atraso ou falha.
- Quando uma etapa de **preparação** ou **entrega** possui mais de cinco pedidos, apenas itens de rotina excedentes ficam em **Ver mais pedidos nesta etapa**. As ofertas novas, incidentes, entregas na chegada, prazos vencidos e próximos continuam à mostra mesmo que a fila seja grande.
- Pedidos não somem nem são removidos: todos seguem montados no DOM; os contadores refletem o total da etapa. Ao usar **Ver pedido**, a interface expande qualquer painel recolhido antes de dar foco ao cartão correto.
- Uma oferta com prazo reconhecivelmente expirado deixa de apresentar os botões de aceitar/recusar e passa a indicar **Prazo desta oferta encerrado** com opção **Atualizar pedidos**. Se o prazo não veio no dado, não se inventa um prazo; o backend permanece autoridade de aceite.
- Menos cartões secundários visíveis em celulares, mas sem esconder qualquer pedido prioritário.

## Garantias

Não altera transição de pedido, servidor, autorizações, dinheiro, confirmação por PIN, banco ou integrações PSP. Nenhuma mudança em Edge Functions ou migrations.

## Verificação

Teste `tests/merchant-attention-compact-v1-274.mjs` e regressões V1.169/V1.174/V1.177/V1.271/V1.272/V1.273; auditoria geral, build e E2E 320/360/390.
