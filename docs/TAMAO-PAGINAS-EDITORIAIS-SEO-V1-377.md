# TAMÃO V1.377 — Páginas públicas editoriais com SEO próprio

Data: 17/10/2026.

## Diagnóstico

A home e as páginas de visita internas apresentam a proposta do TAMÃO em uma aplicação de navegador com rotas por fragmento (`#learn`, `#merchants`, `#sponsors`, `#earn`). Apesar de título e descrição dinâmicos, os links não fornecem HTML próprio para indexação, prévia social ou compartilhamento por audiência. Uma única canonical de home não substitui páginas com mensagens específicas.

O site também já tem fotografia otimizada das categorias e caminhos de cadastro protegidos. A evolução deve usá-los, em vez de apresentar preços, disponibilidade, patrocinadores ou pagamentos fictícios.

## Entregas

### Quatro URLs HTTP independentes

- `https://tamao.com.br/como-funciona/` — para consumidores interessados em gás, água e essenciais; escolha, CEP, confirmação e acompanhamento.
- `https://tamao.com.br/para-revendas/` — vantagens reais da revenda: autonomia, cadastro, operação, taxa por pedidos concluídos sem mensalidade no modelo atual e recebimento direto.
- `https://tamao.com.br/para-marcas/` — três abordagens comerciais para marcas: divulgação identificada, benefício e proximidade regional, dependentes de avaliação e aprovação.
- `https://tamao.com.br/indicacoes/` — Rede TAMÃO e distinção entre convites, cashback e benefícios condicionados.

Todas as páginas são geradas como HTML estático, com `title`, `description`, `canonical` e `og:url` exclusivos. Funcionam sem JavaScript, incluem FAQs acessíveis, navegação cruzada, design responsivo e CTAs que encaminham aos fluxos públicos existentes. Não fazem diretamente qualquer chamada de pedido, lead, saque, pagamento ou habilitação comercial.

### Builds e isolamento

- `build-live-portals.mjs` insere as quatro páginas somente no portal **customer**. Os portais merchant/admin não as recebem. O sitemap do cliente passa a listar as URLs indexáveis, além da home; os outros mantêm a política própria.
- `build-public-site.mjs` gera páginas equivalentes com o `TAMAO_PUBLIC_ORIGIN` válido, mas aplica `noindex` quando a publicação está em pré-lançamento.
- A home oficial recebe links editoriais no rodapé, sem mudar as rotas de compra nem navegar para portais privados. Fora do domínio público oficial, os links não aparecem.
- Nova folha `css/landing-editorial.css` reutiliza a marca verde/âmbar e as imagens locais otimizadas do catálogo, sem fontes externas nem scripts de rastreamento.

### Melhorias na home SPA

Refino de hierarquia no hero, botão principal, galeria de categorias e páginas para revenda/marca/rede. As mudanças CSS não alteram catálogo, taxa, checkout, preço, estoque ou permissão.

## Segurança e compromissos de comunicação

Não existem compradores fictícios, avaliações inventadas, preços ou coberturas prometidos, métricas de alcance fabricadas nem publicidade disfarçada. Conteúdos de revendas e patrocinadores explicam condições reais. Toda criação de pedido, cadastro comercial, associação de indicação ou ativação depende dos controles atuais. A origem de campanhas mantém `ref` e UTM via URLs já autorizadas.

## Validação

- `node tests/public-editorial-seo-v1-377.mjs`: páginas estáticas, 4 canonicals/OG distintos, CTAs públicos, `noindex` em pré-lançamento, compilação isolada por portal, CSS mobile/acessibilidade e ausência de ações financeiras no HTML.
- `Audit` + `Build isolated live portals` no GitHub.
- Verificação visual e teclado em 320, 360, 390, 768 e 1440 pixels.
- A publicação Cloudflare deve ser verificada separadamente pelo commit em `portal-build.json` e checagem das quatro URLs; GitHub integrado não significa automaticamente produção.
- SEO e CTR não têm incremento comprovado até indexação/medição real.
