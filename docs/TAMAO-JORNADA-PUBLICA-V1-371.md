# TAMÃO V1.371 — Jornada pública com prioridade de ação

Data: 17/10/2026. Escopo: home, navegação pública, identidade de página e responsividade.

## Diagnóstico no código

A home possuía atalhos de categoria e mensagem emocional antes do botão principal. Na primeira visita, o visitante precisava atravessar opções secundárias antes de alcançar o caminho para escolher produtos. A mesma entrada chamava o ato de consultar um produto específico de “escolher meus produtos” mesmo quando a rotina selecionava automaticamente o produto destacado. O mecanismo de fallback do catálogo podia iniciar o fluxo que adiciona um P13 caso o painel de descoberta estivesse ausente.

As páginas públicas usavam apenas o `title` e a descrição HTML da home, mesmo quando o visitante navegava por `#learn`, `#earn`, `#merchants` ou `#sponsors`. A troca de seção substituía o DOM, mas não reposicionava sistematicamente o foco do teclado no novo título. O menu inferior ainda usava “Ganhe”, que sugere benefício sem explicitar a ação.

## Evoluções aplicadas à branch

1. O CTA principal ficou acima dos filtros de categoria e da frase de reforço. Continua a respeitar a distinção entre catálogo de possibilidades e oferta real.
2. Quando uma operação já está apta a exibir um produto destacado, o texto do CTA nomeia o produto; quando não está, a ação conserva a escolha neutra.
3. Na ausência do catálogo visual, o botão de descoberta abre uma cesta vazia, sem inserir gás automaticamente.
4. Título e descrição no navegador passam a acompanhar a página pública: compra, funcionamento, Rede, Clube, revendas, marcas e contato.
5. Ao mudar de rota pública, o início da nova página é exibido, o título recebe foco por teclado e uma região de anúncio persistente informa a mudança a tecnologias assistivas.
6. No celular, “Avisos” e “Indicar” são mais curtos e descrevem a ação real.
7. Refinamento visual da primeira dobra e correção de largura para tablet, mantendo leitura, áreas de toque e preferências de movimento reduzido.

## Limites e salvaguardas

- Sem alterações de preços, taxas, cashback, parceiros, pedidos, estoque, pagamentos, RLS, banco ou autorização comercial de cidades.
- Alteração de `document.title` e meta descrição em SPA não significa SEO independente por URL: URLs de hash continuam usando a canonical da home. A indexação de páginas separadas exige trabalho específico de rotas públicas pré-renderizadas.
- A classe de anúncio de rota fica fora de `#app`, evitando que ela seja destruída em cada renderização.
- Os testes estáticos em `tests/public-journey-v1-371.mjs` verificam a ordem da home, fallback neutro, identidade pública e foco sem afetar portais privados.
- A auditoria em CI, a revisão real no navegador e a confirmação de publicação são etapas separadas. Não declarar implantação em produção apenas pela criação da branch ou PR.

## Validação de aceitação

- Executar Audit e verificações de build no GitHub.
- Verificar em 320, 360, 390, 768, 1024 e 1440 px que o CTA é alcançado sem sobreposição e que o menu permanece utilizável.
- Percorrer home → como funciona → revendas → marcas via teclado; conferir título da aba, conteúdo anunciado e retorno do scroll ao topo.
- Simular ausência do painel de catálogo: a cesta deve continuar vazia.
- Confirmar no ambiente publicado o `sourceSha` de cada domínio relevante antes de considerar a atualização ativa.
