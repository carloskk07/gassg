# TAMÃO V1.350 — Descoberta de produtos e cesta sem surpresas

## Problema observado
Na home pública, “Continuar para a cesta” e “Escolher produtos” levavam ao fluxo `startHomeOrder()`. Quando a cesta estava vazia, o mesmo método pré-selecionava P13, mesmo sem um clique explícito no botijão. A página do pedido também listava todos os produtos em uma coluna contínua; conforme o catálogo cresce, selecionar água ou outros itens exige muita rolagem.

## Alterações
1. `startHomeBrowse()` utiliza o fluxo de transferência de CEP de `startHomeOrder`, mas define `addFeatured:false`. Não adiciona gás automaticamente; preserva cesta existente, valida CEP informado e invalida cotação antiga quando o CEP muda. A entrada explícita por um produto em destaque continua podendo iniciar com o SKU escolhido.
2. Botões gerais “Continuar para a cesta” e “Escolher produtos” passam a usar `startHomeBrowse()`, sem mudar a ação do botão que está explicitamente consultando ofertas confirmadas.
3. O catálogo da cesta passa a oferecer filtros **Destaques, Gás, Água e Outros** quando existem mais de oito produtos. O primeiro estado exibe no máximo oito linhas iniciais, além de todos os itens já selecionados. Ao selecionar outra categoria, os produtos já adicionados **continuam visíveis**.
4. Filtros apenas mostram/ocultam elementos existentes no DOM; não modificam preço, estoque, quantidade, atribuição de revenda ou cotação. Os itens exibidos continuam restritos à lista de produtos disponíveis para o cliente no código atual.
5. Acessibilidade: `aria-pressed`, feedback `role=status`, controles com altura para toque, `focus-visible`, título focável e opção de movimento reduzido.

## Invariantes
- Nenhuma cidade ativada; nenhuma regra comercial, RLS, Edge Function, banco, PSP, promoção, saldo ou pagamento alterado.
- A consulta de frete/preço e a criação de pedidos continuam sujeitas à prova real e às verificações já existentes, inclusive validação de endereço, CEP e telefone.
- O trabalho é uma melhoria UX do cliente, não uma promessa de crescimento de conversão. O desempenho deverá ser medido depois com eventos reais e sem perfis simulados.
- O catálogo não representa estoque disponível até que a cotação verdadeira seja confirmada.

## Testes
`tests/buyer-catalog-discovery-v1-350.mjs` valida escolha sem gás implícito, preservação da cesta, CEP, invalidação de provas antigas, produto explícito legado, filtros DOM, visibilidade permanente dos produtos selecionados, botões da home e acessibilidade. Permanecem os testes integrados de navegador em 320/360/390 px e as regressões de pagamento e pedido.

Verificar workflows Audit, Build isolated live portals, release readiness, deploy e reconcile. A inspeção visual de produção requer navegador disponível.
