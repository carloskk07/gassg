# TAMÃO — Portais isolados no Cloudflare Pages

## Objetivo

Substituir o Netlify como requisito de hospedagem dos portais isolados sem abrir mão da separação de origem entre cliente, revenda e administração.

Projetos planejados:

- `tamao-sg-cliente` → `https://tamao-sg-cliente.pages.dev`
- `tamao-sg-revenda` → `https://tamao-sg-revenda.pages.dev`
- `tamao-sg-admin` → `https://tamao-sg-admin.pages.dev`

O Netlify permanece apenas como fallback legado de **produção** durante a transição. Deploy previews e branch deploys ficam fora da autoridade live e devem permanecer restritos à equipe/sem build automático.

O GitHub Pages também deixa de publicar em cada `push`: permanece somente como fallback manual de emergência. A autoridade live é o trio de domínios oficiais validado pelo gate `TAMÃO launch readiness` com igualdade exata de SHA.

As Edge Functions privilegiadas da revenda não autorizam mais a origem Netlify por fallback. Elas aceitam canonicamente `https://parceiro.tamao.com.br` e `https://tamao-sg-revenda.pages.dev`; `MERCHANT_ALLOWED_ORIGIN` só adiciona uma origem quando houver configuração explícita.

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

## Publicação oficial autenticada — V1.216

O workflow GitHub Actions **TAMÃO Cloudflare official production deploy** envia os
pacotes isolados para os três projetos Pages existentes. É diferente do workflow
`Build isolated live portals`, que apenas produz artefatos de testes e pacotes
publicáveis, mas não faz upload ao Cloudflare.

Os projetos oficiais permanecem exatamente:
- `tamao-sg-cliente` → `tamao.com.br`
- `tamao-sg-revenda` → `parceiro.tamao.com.br`
- `tamao-sg-admin` → `admin.tamao.com.br`

### Habilitação única de credenciais (sem compartilhá-las por chat)

1. No painel Cloudflare, localizar **Account ID** de 32 caracteres hexadecimais.
2. Criar um **API Token** de escopo mínimo: **Account → Cloudflare Pages → Edit**
   somente para a conta que hospeda os três projetos.
3. No GitHub do repositório `carloskk07/gassg`, em **Settings → Secrets and
   variables → Actions → New repository secret**, cadastrar:
   - `CLOUDFLARE_ACCOUNT_ID`: ID da conta.
   - `CLOUDFLARE_API_TOKEN`: token com permissão **Pages Write**.
4. **Opcional para recuperação automática:** após criar os segredos, executar uma única vez o workflow
   **Actions → TAMÃO Cloudflare official production deploy → Run workflow → main**
   para publicar o commit atual. Publicações posteriores ocorrerão a cada
   atualização integrada em `main`.

O workflow primeiro espera a propagação da integração Git nativa e exige prova do SHA correto nos três domínios. **Se essa publicação já estiver comprovada, os segredos não são necessários e nenhum segundo upload ocorre.** Somente quando a publicação nativa não se confirma, tenta a recuperação direta usando os dois segredos. Se nessa situação algum segredo faltar, o workflow falha explicitamente e não simula publicação.
Nunca inserir o token em commit, arquivo público, comentário de PR nem mensagem.

### Segurança operacional

- Só `main` e acionamento manual podem publicar; PRs não publicam.
- Os três projetos mantêm **roles e origens próprias**; nenhum bundle privado,
  pasta `supabase` ou testes é enviado.
- O SHA publicado precisa ser **exatamente** `github.sha`; não se aceita
  deploy antigo como sucesso.
- A etapa final só é aprovada quando os três domínios oficiais apresentam o
  mesmo SHA remoto. Publicação parcial mantém o bloqueio de prontidão.
- Token/Account ID não são expostos em logs. O build exige o site key
  Turnstile público de produção.
- Os três projetos Cloudflare Pages podem continuar conectados ao GitHub:
  `wrangler pages deploy` também é aceito em projetos Git-integrados.
- Caso a integração Git original falhe, esse caminho de deploy autenticado
  restaura o site sem migrar domínio ou criar novos projetos.

Referências oficiais:
- https://developers.cloudflare.com/pages/how-to/use-direct-upload-with-continuous-integration/
- https://developers.cloudflare.com/pages/configuration/git-integration/

## Recuperação automática controlada — V1.218

O workflow **TAMÃO Cloudflare native delivery reconcile** continua usando a
confirmação de prontidão OIDC e o SHA exato da `main` como pré-requisitos.
A partir da V1.218, ele também verifica os detalhes **atuais** da execução
que falhou antes de tentar recuperar a publicação:

- A execução precisa pertencer ao repositório, arquivo de workflow, branch e
  commit oficiais; eventos de PR não podem ser recuperados como produção.
- `run_attempt=1` permite **uma única** recuperação automática. Se a execução
  já foi repetida (`run_attempt>=2`), retorna `retry_limit_reached`, sem nova tentativa.
- Estado alterado, tentativas indisponíveis, SHA obsoleto ou divergência entre
  a lista e os detalhes impedem qualquer reexecução especulativa.
- Falhas persistentes exigem investigação humana no GitHub Actions. A rotina
  não cria novos segredos, não publica diretamente e não desativa os gates.

O código de retorno do reconciliador aparece no log como `CF_NATIVE_RECONCILE`.
Um workflow de conciliação concluído com sucesso pode indicar uma recusa
segura de nova tentativa; não substitui a prova do deploy nem da prontidão.

## V1.219 — atestação OIDC resistente à propagação transitória

A Edge Function `portal-readiness-attestor` espera uma janela curta apenas
quando o Cloudflare devolve SHA antigo válido, falha de rede ou HTTP
temporário (404, 408, 425, 429 ou 5xx) durante as leituras de evidência.
São no máximo **três verificações completas** dos três portais, com esperas
de **1,5 s e 3 s** entre elas. Nenhuma evidência parcial é reaproveitada.

Qualquer role, origem, metadata inválida, HTML, runtime ou Turnstile
divergente continua bloqueando a atestação imediatamente. A identidade GitHub
OIDC, branch e SHA canônico são conferidos antes da leitura; o SHA canônico
é revalidado novamente antes do único registro persistido na função SQL.
A rotina não reexecuta escritas financeiras nem relaxa permissões.

Para diagnósticos, os logs da função registram somente papel do portal,
etapa e classificação do erro (`STALE_SOURCE_SHA`, `HTTP_NNN`,
`NETWORK`) e número da tentativa, sem tokens ou dados de clientes.
Após três tentativas, o HTTP 503 é mantido para sinalizar falha real.

## V1.220 — Saúde de publicação no painel administrativo

Na aba **Sistema**, uma consulta autenticada de `admin-ops` reúne:
- HEAD canônico da `main` no GitHub por API pública (somente leitura);
- commits de cliente, revenda e administração no Cloudflare;
- último atestado real `github_oidc_edge` da tabela privada
  `platform_portal_attestations`, sua idade e a prontidão do banco;
- últimas execuções do workflow de publicação e de prontidão pertencentes ao
  repositório e commit oficiais.

O painel apresenta a versão abreviada, situação e motivos legíveis, sem
depender de segredos GitHub ou Cloudflare. Falta de dados, falha do GitHub,
atestado expirado (acima de 60 min), divergência de SHA e execução com falha
não podem aparecer como publicação comprovada. O resultado é apenas um
diagnóstico; não atualiza tabelas, altera modo de operação, publica arquivos
ou modifica políticas financeiras. O gate de prontidão oficial continua
sendo a autoridade de publicação.

## V1.221 — orientação e comprovação de recuperação no Admin

A área Sistema reúne um **plano consultivo** para cada divergência: problema,
impacto, próxima ação humana e critério para encerrar a verificação.

O backend classifica separadamente falhas de disponibilidade do GitHub,
divergências ou ausência de provas nos portais, atestação OIDC ausente/vencida
e falhas, ausência ou execução pendente dos workflows oficiais. Cada motivo
exibe como confirmar a normalização. Não há botões de repetição automática,
modificação de regras ou utilização de credenciais Cloudflare no navegador.

Quando todas as provas coincidem, o quadro mostra **conformidade atual
comprovada**, com quatro verificações: commit `main`, os três portais no
mesmo SHA, atestação OIDC vigente e execução de publicação/prontidão aprovadas.
Isso é uma prova de estado **na consulta atual**, não uma afirmação sobre quando
um incidente histórico foi resolvido. A atualização segue manual pelo botão
existente de diagnóstico; nenhum reparo ocorre sem revisão administrativa.

## V1.222 — integração com a Central de Alertas

Na aba **Alertas**, os perfis com permissão para a publicação
(`superadmin`, `operations`, `readonly`) recebem um grupo único de
**publicação**. O sinal substitui o indicador antigo de portais na mesma
consulta para evitar duplicação. A consulta reaproveita a verificação
dos três portais, lê o commit oficial do GitHub, a prontidão e a última
atestação OIDC privada. Fontes indisponíveis ficam não comprovadas,
nunca saudáveis por omissão.

O item informa gravidade, problema, impacto, correção humana indicada
e critério de verificação, com navegação para **Sistema**. Não cria
incidentes, follow-ups, nem habilita mutações. A prioridade pode subir
quando o histórico GitHub comprovar **duas ou mais execuções com falha**
da mesma branch/repositório/commit e nos últimos sete dias, descontando
execuções duplicadas por ID. Esse histórico não mede indisponibilidade
dos portais e não substitui o monitor horário existente, que continua
limitado às fontes de banco. A prova de conformidade atual depende do
estado GitHub/Cloudflare/Supabase e nunca prova a data histórica de
resolução de um incidente.
