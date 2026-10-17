# TAMÃO V1.392 — Atalhos para o próximo passo da revenda

17/10/2026

## Contexto

A V1.388 já coloca novos pedidos, entregas e ocorrências no mesmo quadro. Entretanto, o botão principal de cada frente apenas rolava até o cartão do pedido, exigindo mais uma busca pelos campos importantes, especialmente no celular.

## Mudanças

- **Novos pedidos:** o atalho verifica se a oferta continua dentro do prazo confirmado e foca no botão de aceite do pedido já existente.
- **Entregas:** o atalho foca o próximo controle disponível segundo a etapa comprovada; chegada, pagamento e código de recebimento seguem a validação preexistente.
- **Atenção:** apenas abre o cartão do problema para revisão, sem focar uma ação que poderia alterar incorretamente o pedido.
- **Guarda no clique:** exige pedido da lista autenticada, revenda selecionada correspondente, papel owner/manager/operator, consulta recente, nenhuma ação pendente, UUID válido e etapa coerente com o cartão.
- Quando o prazo expirou, a consulta é antiga, o pedido mudou de estado, houve troca de revenda ou o usuário perdeu acesso, o atalho não direciona para um controle de ação obsoleto. O caminho seguro é atualizar a fila.
- Todos os demais controles de pedido e fluxos legados são mantidos.

## Limites

A alteração é exclusivamente de navegação e foco em controles já renderizados; não envia pedido, não confirma pagamento, não registra PIN nem altera estados. Supabase, pagamentos, comissões, RLS, permissões de cidades e funções financeiras permanecem intocados.

## Provas

Novo `tests/merchant-contextual-shortcuts-v1-392.mjs` no Audit, cobrindo papel e escopo, estado vencido/desatualizado, troca de revenda, UUID malformado e separação das três frentes. O teste V1.388 passa a conferir os atalhos contextuais sem perder as demais verificações.

Exigir Audit e Build isolated live portals antes do merge. Depois, confirmar commit em Cloudflare, prontidão e reconciliação da entrega.
