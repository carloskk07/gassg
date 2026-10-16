# TAMÃO V1.351 — Ofertas verificadas e decisões claras

Data: 16 de outubro de 2026.

## Falha encontrada e corrigida
Na página de compra, o indicador da jornada filtrava cotações pela validade `expiresAt`, mas os cartões de comparação usavam a coleção bruta `os`. Quando uma proposta expirava entre a consulta e a renderização, o cliente ainda podia enxergar preço, prazo e botão de envio referentes a uma oferta vencida, embora o backend já a rejeitasse.

## Implementação
- `customerEligibleCheckoutOffers` é a fonte compartilhada para comprovar validade: cotações sem data, vencidas, com data inválida ou que expiram em até um segundo são ocultadas do checkout real. A simulação interna explicitamente marcada mantém o seu comportamento de testes.
- A comparação e o indicador de progresso da jornada usam apenas `freshOffers`; se todas as cotações retornadas expirarem, o cliente recebe explicação e botão de consulta nova. Nenhuma compra é registrada por atualizar.
- A ordenação dos cartões por recomendação, menor total ou menor prazo máximo preserva a sequência original do servidor, exclui ofertas vencidas e informa por `role=status` quando houve reordenação ou não há mais cotações válidas.
- Em cenários com duas ou mais ofertas, o resumo exibe o menor total já com entrega e o menor prazo máximo previsto, calculados *apenas dos valores da mesma consulta*, e esclarece que prazo e economia não são garantias.
- O design do resumo e da recuperação é responsivo, legível em 320–390px, navegável por teclado e compatível com redução de movimento.

## Proteções preservadas
- Não modifica preço bruto, taxa de entrega, cashback, ordem sugerida, resultado do PSP, opção de pagamento, estoque, permissão nem pedido.
- O endpoint `liveCreateOrder` já faz a verificação obrigatória de validade antes de transmitir qualquer pedido; a nova UX reduz erros e não a substitui.
- A revenda permanece anônima antes do aceite conforme as regras já estabelecidas, e somente cotações verdadeiramente elegíveis entram no checkout público.
- Não há alteração no banco, Edge Functions, fluxo de abertura de cidades ou regras administrativas; ofertas simuladas não são anunciadas como reais.

## Testes
- `tests/verified-offer-clarity-v1-351.mjs`: expiração, tolerância de um segundo, data inválida, resumo preço/prazo, ausência de vencedores falsos quando empata, ordenação segura, recuperação e tipografia responsiva.
- Permanecem `tests/transparent-offer-comparison-v1-163.mjs`, `tests/buyer-checkout-journey-v1-302.mjs`, auditoria estática, testes de CEP e browser em três tamanhos móveis.
- Critério para produção: audit e build na PR, integração à main, prontidão e publicação Cloudflare/conciliation confirmadas.

## Pendências fora deste escopo
Inspeção manual autenticada da publicação e medição real de tempo para compra/conversão. Nenhum ganho é reivindicado antes de haver dados.
