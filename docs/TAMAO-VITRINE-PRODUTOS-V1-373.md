# TAMÃO V1.373 — Home com vitrine de produtos acionável

Data: 17/10/2026.

## Problema
A primeira tela pública já tinha imagens de gás e água, porém a vitrine funcionava apenas como elemento decorativo. Para selecionar um produto o visitante precisava descobrir outra ação ou descer a tela. Isso criava uma desconexão entre o visual mais chamativo e a tarefa mais importante: começar a compra.

## Mudanças
- Cada foto/cartão na vitrine principal passa a ser um `button` semântico, com texto de ação e rótulo acessível.
- A vitrine usa exclusivamente os `discoveryEntries` do catálogo público, respeitando a filtragem existente de produtos ocultos e os códigos disponíveis quando existe configuração de oferta real. A ordenação dá prioridade a P13 e água 20 L **somente se esses itens forem navegáveis no catálogo**.
- O clique executa o fluxo existente `quickProduct(code)`: escolha explícita, nova cesta com aquele produto, ida à página de pedido para consulta, sem criação de pedido ou cobrança.
- Se houver apenas um produto navegável, mostra apenas um cartão clicável. Se não houver nenhum, apresenta um acesso ao catálogo em vez de imagens falsas de produtos disponíveis.
- A frase de apoio explica que o preço e a entrega são condicionados à verificação por CEP, e há CTA adicional `Explorar todos os produtos` que usa a navegação segura existente.
- CSS responsivo preserva imagens do sprite atual, adapta toque e tipografia para 320–390 px, fornece estado de foco e respeita movimento reduzido.

## Verificações e riscos
- `tests/home-product-hero-v1-373.mjs` executa isoladamente a construção da vitrine com conjuntos variados de catálogo: P13 + água, apenas água, apenas outro item, catálogo vazio.
- O teste protege explicitamente: escolher água nunca insere gás; não renderizar produto oculto/ausente; preservar a consulta pelo CEP e a comprovação de preços locais.
- Manter os testes `Audit`, `Build isolated live portals`, e testes de navegação mobile.
- Não modifica estoque, catálogo persistido, preço, comissões, cashback, autenticação, permissões, integração de pagamentos, abertura de cidades, banco de dados nem a disponibilidade comercial.
- Nenhuma melhoria em CTR ou conversão deve ser anunciada sem evidência medida.

## Publicação
A integração no GitHub não garante a atualização imediata do site. Confirmar o workflow oficial Cloudflare e a reconciliação da entrega nativa antes de declarar publicação concluída.
