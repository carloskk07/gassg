# TAMÃO — lançamento e operação

## V1.62 — Central de Produção

A abertura real passa a ser governada por três estados de prontidão: `READY`, `READY_WITH_WARNINGS` e `BLOCKED_SECURITY`. Apenas o último representa bloqueio técnico absoluto.

Pendências de negócio aparecem no admin com condição, risco, recomendação e confirmação explícita. A confirmação exige motivo, aceita evidência e validade opcional, e gera auditoria. Segurança estrutural, RLS, privilégios, integridade financeira e RPCs privilegiadas continuam fail-closed.

Modos operacionais:

- `PRELAUNCH` — captação e preparação, sem novos pedidos reais;
- `PILOT` — pedidos reais em operação controlada;
- `LIVE` — operação normal;
- `PAUSED` — kill switch para novos pedidos, preservando pedidos existentes e os painéis.

A primeira abertura deve usar **PILOT**.



## Estado atual

- Marca pública: **TAMÃO**
- Assinatura: **Pediu? Tá na mão.**
- Domínio adquirido: `tamao.com.br`
- DNS/Cloudflare: aguardando liberação da alteração no Registro.br
- Comércio real: **fechado**
- Indexação: **bloqueada**
- Captação de clientes: pronta
- Captação de parceiros: pronta
- Canal de contato e privacidade: pronto
- Inbox administrativa de leads/solicitações: pronta
- Admin operacional: reserva criada; primeira conta ainda precisa ser reivindicada
- Gateway `admin-auth`: prova remota OK (`request-link` pré-JWT chega ao handler; `claim` sem sessão é bloqueado)
- Portal admin Cloudflare Pages: código pronto; falta criar o projeto `tamao-sg-admin` na conta Cloudflare
- Turnstile dos portais isolados: site key pública já disponível; falta autorizar os hostnames `pages.dev` no widget
- Netlify: opcional/fallback; upgrade não é requisito para o lançamento

## Regra principal

**Não comprar tráfego para o domínio antes de DNS + HTTPS + formulário real passarem na verificação.**

O GitHub Pages continua sendo laboratório técnico. O domínio oficial será publicado via Cloudflare Pages.

## Netlify — fallback legado

Os projetos Netlify existentes permanecem somente como caminho de rollback. Nenhum upgrade do Netlify é necessário para seguir com o TAMÃO.

## Cloudflare Pages — portais isolados agora

Esta etapa **não depende da troca de nameservers do tamao.com.br**.

Os projetos usam o mesmo repositório e a mesma configuração:

- Repository: `carloskk07/gassg`
- Production branch: `main`
- Root directory: vazio
- Build command: `node scripts/build-cloudflare-portal.mjs`
- Build output directory: `dist/cloudflare-portal`

Projetos:

- `tamao-sg-admin`
- `tamao-sg-cliente`
- `tamao-sg-revenda`

O builder identifica automaticamente a role pelo `CF_PAGES_URL`. A site key pública Turnstile já está versionada, portanto não é preciso cadastrar variável de ambiente para ela.

Para destravar o primeiro administrador, basta criar primeiro **somente `tamao-sg-admin`**. Cliente e revenda podem ser criados depois.

No widget Turnstile atual, autorizar:

- `tamao-sg-admin.pages.dev`
- `tamao-sg-cliente.pages.dev`
- `tamao-sg-revenda.pages.dev`
- `tamao.com.br`

## Cloudflare Pages — configuração preparada

Quando a alteração de nameservers estiver liberada:

1. Adicionar `tamao.com.br` à Cloudflare no plano Free.
2. Trocar na registradora os nameservers pelos dois fornecidos pela Cloudflare.
3. Criar um projeto Cloudflare Pages conectado a `carloskk07/gassg`.
4. Branch de produção: `main`.
5. Variáveis iniciais do Pages:
   - `TAMAO_DEPLOY_TARGET=cloudflare`
   - `TAMAO_PUBLIC_ORIGIN=https://tamao.com.br`
   - `TAMAO_PUBLIC_INDEXING=0`
   - `TAMAO_LIVE_RUNTIME=0`
6. Build command:
   `node scripts/build-public-site.mjs dist`
7. Output directory:
   `dist`
8. Adicionar os custom domains:
   - `tamao.com.br`
   - `www.tamao.com.br`
9. Validar HTTPS nos dois hosts.
10. Definir `tamao.com.br` como canônico. O redirecionamento de host deve ser criado por **Bulk Redirect** na Cloudflare; `_redirects` do Pages não governa redirect de domínio.
11. Validar que nenhum diretório interno (`supabase/`, `tests/`, `scripts/`, `.github/`) foi publicado.
12. O build Cloudflare gera `_headers` automaticamente com CSP, anti-frame, política de referrer, Permissions-Policy e cache restritivo para HTML/service worker/runtime config.

## Prova antes do primeiro anúncio

### Prova do primeiro administrador

Usar somente a origem administrativa dedicada configurada para o control plane.

Antes do magic link, concluir estes gates externos:

- no widget Turnstile atual, autorizar `tamao-sg-admin.pages.dev`;
- criar o projeto Cloudflare Pages `tamao-sg-admin` conectado ao repositório;
- usar build command `node scripts/build-cloudflare-portal.mjs`;
- usar output `dist/cloudflare-portal`;
- confirmar que `https://tamao-sg-admin.pages.dev/portal-build.json` responde e declara role `admin`;
- executar **TAMÃO launch readiness** e exigir resultado verde.

A site key Turnstile é pública por definição e já está versionada no builder. A secret key continua fora do repositório e do frontend.

1. confirmar que a função `admin-auth` está publicada com `verify_jwt=false` — o primeiro pedido de magic link ocorre antes de existir JWT;
2. confirmar na sonda remota que `request-link` sem CAPTCHA retorna `CAPTCHA_REQUIRED` e `claim` sem bearer retorna `UNAUTHORIZED`;
3. abrir o portal admin dedicado;
4. solicitar o magic link com o e-mail previamente reservado;
5. abrir o link recebido no mesmo fluxo administrativo;
6. confirmar que o servidor retorna `claimed` no primeiro acesso ou `existing_admin` nos acessos seguintes;
7. confirmar que o resumo administrativo carrega;
8. confirmar no banco que existe pelo menos 1 admin ativo;
9. somente então considerar o gate administrativo concluído.

Se aparecer `not_reserved`, não insistir nem criar nova reserva automaticamente: o e-mail autenticado não corresponde à reserva atual.

Se aparecer `bootstrap_closed`, já existe outro administrador ativo; a nova conta deve ser adicionada por ele.

Se houver erro de validação/concorrência, usar **Validar acesso novamente**. O sistema não concede permissão por fallback.


**Gate obrigatório antes de comprar tráfego:** reivindicar a conta administrativa reservada, entrar no portal admin e comprovar que o CRM carrega. Hoje existe uma reserva ainda não reivindicada, nenhum admin ativo e ainda não há usuário permanente confirmado correspondente à reserva; sem admin ativo, leads podem ser captados mas ninguém consegue operar a fila protegida.

Executar em mobile e desktop:

- home abre em HTTPS;
- login administrativo reservado funciona;
- resumo administrativo e funil de aquisição carregam;
- canonical aponta para `https://tamao.com.br/`;
- logo e favicon carregam;
- lista de abertura salva lead no Supabase;
- lead aparece no admin;
- landing de parceiro salva lead;
- parceiro aparece no admin;
- Privacidade abre;
- Termos abre;
- Contato envia solicitação;
- solicitação aparece no admin;
- refresh mantém PWA funcional;
- sem erro no console;
- sem overflow horizontal;
- sem conteúdo de simulação confundido com operação real.

## Indexação

Enquanto o domínio estiver em preparação:

- `meta robots = noindex,nofollow,noarchive,nosnippet`;
- `robots.txt = Disallow: /`.

Somente depois do domínio, HTTPS e conteúdo final passarem na prova:

- remover `noindex`;
- publicar robots para crawling;
- adicionar sitemap;
- validar Google Search Console;
- revisar metadata social final.

## Comércio real

A liberação de indexação e anúncios de pré-lançamento **não abre pedidos reais**.

Pedidos reais continuam dependentes dos gates server-side:

- admin ativo;
- primeira revenda real configurada;
- owner permanente;
- pagamento configurado;
- compliance aplicável;
- catálogo/estoque/preço frescos;
- capacidade de receber oferta agora;
- portais live atestados;
- ação administrativa explícita de go-live.

## Rollback

Se domínio, SSL, captação ou PWA falharem:

1. pausar anúncios;
2. manter comércio fechado;
3. voltar o domínio para página de manutenção ou build anterior;
4. corrigir;
5. repetir a prova de lançamento antes de retomar tráfego.


## Operação dos primeiros leads

Quando a captação pública começar, o admin deve ser tratado como uma fila operacional, não como arquivo de contatos.

### Cliente

1. `NOVO` — acabou de entrar.
2. `CONTATADO` — houve tentativa real de contato.
3. `QUALIFICADO` — confirmou interesse/região/categoria.
4. `CONVERTIDO` — virou cliente real quando a operação abrir.
5. `ENCERRADO` — sem continuidade; registrar motivo.

### Parceiro

Usar o mesmo pipeline, mas considerar `CONVERTIDO` somente quando a empresa efetivamente avançar para o onboarding real, não apenas por responder no WhatsApp.

### Contato e privacidade

- `NOVA` — ainda não tratada;
- `EM ANÁLISE` — alguém assumiu o caso;
- `RESOLVIDA` — houve solução documentada;
- `ENCERRADA` — fluxo finalizado.

Nunca marcar uma solicitação de privacidade como resolvida só por enviar uma mensagem inicial. A resolução deve refletir a providência efetivamente tomada.

### Disciplina de campanha

Não comparar campanhas somente por cliques. A métrica operacional inicial deve priorizar:

- leads novos;
- leads contatados;
- leads qualificados;
- leads convertidos;
- parceiros qualificados;
- origem/campanha de cada conversão.

Isso evita otimizar anúncios para volume de formulário sem valor comercial.


## Chaves de publicação Cloudflare

### Pré-lançamento para anúncios

Manter:

- `TAMAO_DEPLOY_TARGET=cloudflare`
- `TAMAO_PUBLIC_ORIGIN=https://tamao.com.br`
- `TAMAO_PUBLIC_INDEXING=0`
- `TAMAO_LIVE_RUNTIME=0`

Esse modo aceita captação de clientes/parceiros e contato público, mas mantém indexação bloqueada e não habilita comércio real.

**Anúncio pago não depende de indexação orgânica.** Depois de DNS, HTTPS e formulários passarem na prova real, campanhas de pré-lançamento podem apontar para o domínio ainda em `noindex`.

### Abrir indexação orgânica

Somente após a prova de domínio:

- mudar `TAMAO_PUBLIC_INDEXING=1`;
- redeploy.

O build troca o meta robots, publica `robots.txt` com `Allow: /`, cria `sitemap.xml` e remove o header `X-Robots-Tag: noindex`.

### Runtime real do cliente

Somente na etapa de comércio real, mudar `TAMAO_LIVE_RUNTIME=1` e configurar também:

- `CHAMA_CUSTOMER_ORIGIN=https://tamao.com.br`;
- `CHAMA_MERCHANT_ORIGIN=<origem HTTPS isolada da revenda>`;
- `CHAMA_ADMIN_ORIGIN=<origem HTTPS isolada do admin>`;
- `CHAMA_TURNSTILE_SITE_KEY=<site key real>`.

O build falha se a origem do cliente não coincidir com o domínio público, se faltar qualquer origem privilegiada ou se a chave Turnstile for uma chave conhecida de teste.


## Analytics de pré-lançamento

A medição inicial é first-party e agregada. Não instalar Meta Pixel ou Google Analytics nesta fase.

O funil esperado no admin é:

1. **Entradas** — uma contagem por sessão/aba, público e conjunto de UTM.
2. **Viram formulário** — o formulário ficou visível em pelo menos 35%.
3. **Viraram lead** — cadastro real salvo.
4. **Contatados**.
5. **Qualificados**.
6. **Convertidos**.

Os dois primeiros estágios são contadores agregados; os demais vêm do CRM real. Não interpretar "Entradas" como pessoas únicas.
