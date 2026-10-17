# TAMÃO V1.376 — Primeira impressão e páginas públicas mais objetivas

Data: 17/10/2026.

## Diagnóstico no código

- O `#app` era completamente vazio no HTML inicial. Toda a mensagem de valor aguardava a execução dos scripts. Na primeira visita, isso cria um estado visual frágil em conexões lentas ou bloqueadas. O fallback estático **não substitui** renderização no servidor nem cria páginas SEO independentes.
- A vitrine sem revendas verificadas criava três cartões de preço de referência para um único produto P13. Apesar dos avisos, a linguagem visual podia parecer três ofertas de lojas.
- As páginas comerciais estavam acumulando caminhos repetidos: na revenda, um novo atalho de cadastro logo depois do formulário de interesse; nas marcas, outra grade de três benefícios que repetia formatos já apresentados.
- Na navegação principal, "Ganhe" e "Marcas" eram menos autoexplicativos que "Indicações" e "Para marcas".

## O que muda

1. **Primeira pintura informativa.** O HTML inicial entrega a identidade TAMÃO, proposta de valor, áreas de atuação e links públicos reais; é substituído quando o aplicativo renderiza. Conteúdo inicial não afirma preço, estoque, oferta, cobertura garantida ou operação ativa.
2. **Inicialização.** O portal público ganha uma primeira renderização no `DOMContentLoaded`, após os scripts `defer`, sem aguardar imagens. Os portais privados mantêm o callback de autenticação no fluxo `load` antes de qualquer renderização; o fluxo público também completa normalmente a carga e pode re-renderizar com dados atualizados.
3. **Vitrine regional.** Ofertas reais ainda usam a RPC comercialmente controlada. Quando não há oferta comprovada, São Gabriel mostra **uma única referência** com valor usual e faixa, explicitamente não vinculada a uma revenda. Nenhuma referência vira botão de compra.
4. **Revendas e marcas.** O cadastro continua logo após o hero; o trilho agora prioriza duas perguntas úteis (taxas e entregas). A página de marcas mantém três formatos, seus botões de contato e a explicação de como a campanha pode ser construída, sem uma segunda grade genérica de benefícios.
5. **Navegação e adaptação.** Microcopy do menu mais clara, referência responsiva e foco de teclado perceptível no fallback. O cache atual utiliza política network-first para buscar os assets novos sem modificar a geração PWA.

## Preservações e limites

- Sem mudanças em Supabase, RLS, Edge Functions, PSP, taxas, ordens, produtos, cashback, indicações, abertura de cidade e autorizações de administração.
- A campanha de marca é conceitual até existir contratação e ativação explícita.
- Um preço de referência **não é oferta**: só ofertas elegíveis e recentes da fonte autorizada são preços de revendas.
- Referência visual de carregamento inicial não é uma página SEO independente. Para indexar `#merchants`, `#sponsors` etc. em resultados separados, o caminho futuro é pré-renderização ou rotas HTTP dedicadas com canonicals próprios.
- Esta PR não prova aumento de conversão. Resultados devem ser medidos com dados agregados e testes reais.

## Validação antes da publicação

- `node tests/public-first-impression-v1-376.mjs` e testes existentes de marketing, catálogo e jornadas.
- Workflow `Audit` e construção isolada dos portais.
- Revisão visual 320, 360, 390, 768 e 1440 px, teclado e leitor de tela; primeira visita, rota comercial, ausência de ofertas e cidade com ofertas verificadas.
- Após integração, verificar Cloudflare e `portal-build.json` dos domínios; somente então informar produção.
