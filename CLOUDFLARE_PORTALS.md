# TAMÃO — Portais isolados no Cloudflare Pages

## Objetivo

Substituir o Netlify como requisito de hospedagem dos portais isolados sem abrir mão da separação de origem entre cliente, revenda e administração.

Projetos planejados:

- `tamao-sg-cliente` → `https://tamao-sg-cliente.pages.dev`
- `tamao-sg-revenda` → `https://tamao-sg-revenda.pages.dev`
- `tamao-sg-admin` → `https://tamao-sg-admin.pages.dev`

O Netlify permanece apenas como fallback legado de **produção** durante a transição. Deploy previews e branch deploys ficam fora da autoridade live e devem permanecer restritos à equipe/sem build automático.

O GitHub Pages também deixa de publicar em cada `push`: permanece somente como fallback manual de emergência. A autoridade live é o trio de domínios oficiais validado pelo gate `TAMÃO launch readiness` com igualdade exata de SHA.

## Por que Cloudflare Pages

Os três projetos podem apontar para o mesmo repositório `carloskk07/gassg`.

O builder `scripts/build-cloudflare-portal.mjs` identifica automaticamente a role pelo `CF_PAGES_URL` gerado pelo próprio Cloudflare Pages. Assim, os três projetos usam exatamente a mesma configuração:

- Production branch: `main`
- Root directory: vazio
- Build command: `node scripts/build-cloudflare-portal.mjs`
- Build output directory: `dist/cloudflare-portal`

Nenhuma variável de role ou origem precisa ser configurada manualmente.

## Turnstile

A site key pública já utilizada pelo TAMÃO fica versionada no builder:

`0x4AAAAAAFNKDvnzxtYQ9WM2`

Isso é intencional: site keys Turnstile são valores públicos usados no frontend. A secret key continua fora do repositório e do bundle.

No widget correspondente, autorizar estes hostnames:

- `tamao-sg-admin.pages.dev`
- `tamao-sg-cliente.pages.dev`
- `tamao-sg-revenda.pages.dev`
- `tamao.com.br`

Adicionar o domínio raiz `tamao.com.br` cobre também os futuros subdomínios `admin.tamao.com.br` e `parceiro.tamao.com.br`.

## Ordem mínima para destravar o primeiro admin

Não é necessário criar os três projetos imediatamente.

Primeiro:

1. Criar apenas o projeto Pages `tamao-sg-admin`.
2. Conectar ao GitHub `carloskk07/gassg`.
3. Selecionar branch `main`.
4. Informar o build command e output acima.
5. Fazer o primeiro deploy.
6. Abrir `https://tamao-sg-admin.pages.dev/?admin=1#admin`.
7. Solicitar o magic link com a conta administrativa reservada.
8. Confirmar que o CRM administrativo abre.

Depois podem ser criados `tamao-sg-cliente` e `tamao-sg-revenda` usando exatamente a mesma configuração.

## Segurança da transição

O backend aceita:

- as novas origens Cloudflare Pages;
- as futuras origens TAMÃO;
- as origens Netlify antigas apenas como fallback de migração.

A autoridade de prontidão administrativa, entretanto, passa a atestar os bundles Cloudflare Pages como referência principal.

Preview URLs aleatórias do Pages não são tratadas como origem live. Isso é proposital: portais privilegiados devem operar somente na origem de produção conhecida.

## Depois do domínio

Quando `tamao.com.br` estiver sob Cloudflare:

- cliente → `https://tamao.com.br`
- revenda → `https://parceiro.tamao.com.br`
- admin → `https://admin.tamao.com.br`

A migração de `pages.dev` para esses hosts será feita numa versão posterior, depois de HTTPS e DNS passarem na prova.
