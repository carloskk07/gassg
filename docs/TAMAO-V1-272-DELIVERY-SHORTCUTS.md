# TAMÃO V1.272 — Atalhos simples para pedidos e entregas

## O que melhora para as revendas

- Os quatro números da fila (para aceitar, atenção, em entrega e preparando) passam a ser **atalhos clicáveis**. Um toque foca a etapa correspondente; números vazios ficam desativados. A fila completa e os avisos gerais continuam visíveis.
- Em pedidos que já estão **em entrega** ou **chegando**, aparecem ações rápidas **Abrir rota** (Google Maps) e **Ligar para cliente**.
- Esses links são apresentados **somente** quando o servidor já liberou explicitamente endereço e detalhes de entrega para a pessoa autenticada. Pedido ofertado, em preparação ou sem autorização não ganha atalhos.
- Abrir o Google Maps é ação expressa do usuário. O endereço de entrega é enviado ao Maps apenas após clicar no link. O TAMÃO não abre aplicativo de mapas automaticamente.
- O telefone usa `tel:+55...` validado e o link da rota usa endereço codificado; texto arbitrário não vira atributo executável.
- Botões de aceite, saída, chegada, PIN e pagamento permanecem intocados. Nenhuma operação muda sem confirmação no cartão e backend.

## Limites

Nenhuma migração, nova permissão de acesso, pagamento, transferência ou API. Contagem dos pedidos usa somente a lista segregada do servidor.

## Testes

`tests/merchant-delivery-shortcuts-v1-272.mjs`, regressões da fila V1.174, entregas V1.175, marcos V1.176, alertas V1.177 e incidentes V1.178; auditoria completa, testes de segurança e E2E em celulares.
