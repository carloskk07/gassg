# TAMÃO — marketplace local de essenciais

Marketplace hiperlocal de gás e abastecimento essencial para São Gabriel/RS.


## Estado atual — v1.62 autoridade operacional administrável

O go-live deixa de tratar toda pendência comercial como falha técnica. A autoridade server-side agora separa:

- `READY` — requisitos recomendados satisfeitos;
- `READY_WITH_WARNINGS` — pendências operacionais visíveis, assumíveis por administrador autorizado com motivo, evidência, validade opcional e auditoria;
- `BLOCKED_SECURITY` — falha de segurança/integridade que permanece fail-closed.

A operação possui modos explícitos `PRELAUNCH / PILOT / LIVE / PAUSED`. `commerce_enabled` continua existindo como compatibilidade e só fica ativo em PILOT/LIVE.

O painel administrativo passa a apresentar uma **Central de Produção**. O kill switch muda para PAUSED sem apagar pedidos existentes. O caminho legado de “abrir comércio” inicia em PILOT, nunca promove automaticamente para LIVE.

Confirmações administrativas ficam em `platform_launch_confirmations`, sem acesso de `anon/authenticated`, e todas as decisões são registradas em `platform_admin_audit`.



## V1.63 — onboarding assistido do primeiro parceiro

O administrador pode converter um parceiro piloto em uma revenda real sem SQL manual. A conversão cria a revenda em estado `pending`, registra dados comerciais server-only, catálogo/preço/estoque inicial, formas de pagamento explicitamente selecionadas e configuração logística.

O fluxo **não** fabrica validação: compliance nasce pendente, a revenda permanece offline e o owner pode ser vinculado quando a conta permanente existir. Toda conversão é idempotente e auditada.


## V1.64 — Torre de Controle de pedidos

O admin passa a enxergar pedidos reais em uma Torre de Controle com estados operacionais, atraso, risco, revenda, itens, pagamento e destino. As intervenções não fazem `UPDATE` livre: observação, rescue e cancelamento antes da saída passam por uma autoridade server-side idempotente e auditada.

O rescue reaproveita as regras transacionais existentes para revalidar estoque, capacidade, compliance, pagamento e preço. Se a alternativa for mais cara, o cliente continua sendo a autoridade para aceitar a nova condição. Depois da saída para entrega, cancelamento/reatribuição automática pelo admin é bloqueado.


## V1.65 — política comercial administrável

Taxa TAMÃO, reserva de custo, contribuição mínima, cashback, indicação e carência de comissão passam a ter autoridade administrativa versionada e auditada.

Regras importantes:

- mudanças afetam apenas pedidos futuros; cada pedido preserva snapshots financeiros;
- o backend rejeita políticas em que taxa, custos, contribuição mínima e recompensas não fecham economicamente;
- a política não pode ser desativada durante `PILOT` ou `LIVE`; primeiro é necessário pausar a operação;
- histórico fica em `financial_policy_history`, server-only;
- a landing e os simuladores públicos consomem a política sanitizada via `market-status`, evitando texto comercial desatualizado;
- 7,5% de taxa, 1% de cashback e 2% de indicação permanecem como baseline atual, não como hardcode público.

## Estado atual — v1.61 cloudflare portals

O Netlify deixa de ser requisito para os portais isolados. A rota principal passa a ser **Cloudflare Pages**, mantendo o Netlify apenas como fallback de migração.

Projetos previstos:

- `tamao-sg-cliente` → `https://tamao-sg-cliente.pages.dev`;
- `tamao-sg-revenda` → `https://tamao-sg-revenda.pages.dev`;
- `tamao-sg-admin` → `https://tamao-sg-admin.pages.dev`.

Todos podem usar o mesmo repositório e a mesma configuração:

- build command: `node scripts/build-cloudflare-portal.mjs`;
- output: `dist/cloudflare-portal`;
- branch: `main`.

O builder infere a role pelo `CF_PAGES_URL`, usa `CF_PAGES_COMMIT_SHA` como origem de atestação e já contém a site key pública Turnstile usada pelo TAMÃO. A secret key continua fora do repositório.

O backend aceita as novas origens Cloudflare, as futuras origens `tamao.com.br` e mantém as origens Netlify apenas como fallback temporário.

## Estado atual — v1.60 netlify zero-config

Os três projetos Netlify podem ser conectados ao mesmo repositório sem preencher manualmente Base directory, Build command, Publish directory ou Functions directory.

O arquivo `netlify.toml` versiona:

- build: `node scripts/build-netlify-portal.mjs`;
- publish: `dist/netlify`;
- Node 22.

O builder identifica automaticamente:

- `chama-sg-cliente` → customer;
- `chama-sg-revenda` → merchant;
- `chama-sg-admin` → admin.

As origens HTTPS atuais dos três portais também possuem defaults versionados. A única configuração externa que continua obrigatória para um bundle live é a **site key real do Cloudflare Turnstile**.

## Estado atual — v1.59 portal handoff

O release dos portais isolados deixa de depender de um GitHub Secret desnecessário para a site key Turnstile.

A site key é pública e já precisa aparecer no frontend. O workflow manual **Build isolated live portals** agora solicita `turnstile_site_key` diretamente no disparo e:

- recusa vazio;
- recusa as chaves oficiais de teste/demo;
- gera customer / merchant / admin com a mesma origem validada;
- confere que a chave fornecida realmente entrou no runtime;
- gera `SHA256SUMS.txt` dentro de cada bundle;
- verifica todos os checksums antes do upload;
- mantém os artefatos disponíveis por apenas 3 dias.

A chave secreta do Turnstile não entra no GitHub nem no bundle.

Durante esta rodada também foi detectado e eliminado um **drift de source-of-truth**: a `admin-auth` publicada já continha quota por IP, mas a `main` ainda não refletia esse código. A versão canônica passa a preservar essa proteção e reforça o contrato: quota por IP → CAPTCHA obrigatório → elegibilidade do e-mail → quota de entrega por e-mail → OTP.

## Estado atual — v1.58 remote readiness

A prontidão administrativa passa a ser provada também **fora do runner local**.

A sonda `tests/remote-admin-readiness.mjs` chama a infraestrutura real e confirmou:

- `admin-auth/request-link` chega ao handler sem JWT e é rejeitado pelo próprio gate de CAPTCHA (`CAPTCHA_REQUIRED`);
- `admin-auth/claim` continua fechado sem bearer (`UNAUTHORIZED`);
- portanto, o bloqueio de `verify_jwt` encontrado na v1.57 está efetivamente corrigido em produção.

A mesma sonda encontrou um bloqueio externo independente: o projeto Netlify `chama-sg-admin` existe, mas o bundle isolado ainda não está publicado; HTML, `runtime-config.js` e `portal-build.json` retornam 404.

Também foi confirmado que o GitHub Actions ainda não possui `CHAMA_TURNSTILE_SITE_KEY` real. O pipeline foi separado em dois níveis:

- **validate** — roda automaticamente e usa somente a chave oficial de teste da Cloudflare para provar o builder; não publica nem faz upload de artefato de produção;
- **production-bundle** — roda apenas manualmente e exige uma chave Turnstile real; bloqueia chaves conhecidas de teste/demo e então gera os três artefatos publicáveis.

O workflow manual **TAMÃO launch readiness** continua falhando fechado até o portal administrativo remoto estar realmente online.

## Estado atual — v1.57 admin bootstrap diagnostics

O primeiro acesso administrativo deixa de tratar toda falha como simples "conta não autorizada".

A autoridade `admin-auth` agora devolve ao navegador apenas um estado seguro de bootstrap:

- `claimed` — a reserva inicial foi reivindicada;
- `existing_admin` — a conta já era um administrador ativo;
- `not_reserved` — a conta autenticada não corresponde à reserva inicial;
- `bootstrap_closed` — já existe administrador ativo e a janela inicial foi encerrada.

Falhas reais de concorrência ou backend retornam erro explícito e **não concedem permissão por fallback**. A UI oferece nova tentativa de validação sem executar qualquer autoelevação no browser.

O pedido inicial de magic link continua respondendo genericamente para não permitir enumeração de e-mails.

Durante a auditoria foi identificado um bloqueio de implantação: `admin-auth` estava publicada com `verify_jwt=true`, embora `request-link` precise funcionar antes da existência de uma sessão. A política agora fica versionada em `supabase/config.toml` com `verify_jwt=false` para as funções públicas controladas. O claim privilegiado continua exigindo bearer token e `auth.getUser` dentro do handler.

## Estado atual — v1.56 first-party analytics

O pré-lançamento passa a medir o funil desde a entrada no domínio oficial, sem adicionar trackers publicitários de terceiros.

### Eventos agregados

- `landing_view` — uma entrada por sessão/aba, público e atribuição;
- `lead_form_view` — formulário visível em pelo menos 35%.

Os eventos são consolidados por dia, público, source, medium, campaign, content, rota e host de referência. A tabela não recebe nome, telefone, CEP, IP bruto nem identificador analítico persistente.

### Escopo

O runtime só mede quando:

- o host é `tamao.com.br` ou `www.tamao.com.br`;
- o produto ainda está em modo de pré-lançamento;
- não é portal administrativo/revenda;
- não é ambiente de teste.

GitHub Pages, localhost e previews não contaminam os números.

### Funil

O admin passa a mostrar:

**Entradas → formulário → lead → contato → qualificação → conversão**

Assim, tráfego pago pode ser avaliado pela qualidade do funil inteiro, e não só por cliques ou formulários.

## Estado atual — v1.55 acquisition intelligence

O admin passa a medir o pré-lançamento como **funil comercial**, e não apenas como uma lista dos 200 contatos mais recentes.

Uma função agregadora server-side calcula sobre a base completa:

- total de leads, clientes e empresas;
- volume dos últimos 7 e 30 dias;
- novos ainda sem contato após 24 horas;
- taxa de contato;
- taxa de qualificação;
- taxa de conversão;
- conversão de qualificado para convertido;
- média e mediana do tempo até o primeiro contato;
- desempenho por source / medium / campaign.

O navegador recebe somente os agregados necessários para essas métricas. A lista operacional continua limitada aos contatos recentes, evitando ampliar a exposição de PII só para produzir estatísticas.

A autoridade `admin_prelaunch_acquisition_metrics` exige administrador válido e possui EXECUTE somente para `service_role`.

## Estado atual — v1.54 follow-up operations

O mini-CRM de pré-lançamento agora ajuda o operador a agir, não apenas visualizar contatos:

- leads são priorizados por estágio e, dentro do estágio, os mais antigos aparecem primeiro;
- o admin destaca **Novos há +24h** para reduzir esquecimento;
- o WhatsApp de cliente abre com uma mensagem inicial contextualizada sobre a lista de abertura;
- o WhatsApp de parceiro abre com mensagem específica sobre parceria em São Gabriel;
- solicitações públicas por WhatsApp recebem mensagem com protocolo e contexto, sem copiar o conteúdo sensível da solicitação para a URL;
- abrir o WhatsApp continua **sem alterar o status automaticamente** — o operador confirma o estágio somente depois da ação real.

## Estado atual — v1.53 conversion UX

O pré-lançamento público agora prioriza conversão e remove becos sem saída:

- o switcher **Quero vender** abre a landing pública de empresas enquanto o portal real ainda não possui origem dedicada;
- a navegação mobile de pré-lançamento troca ações de pós-compra por **Início / Abertura / Como funciona / Vender / Contato**;
- o CTA **Abertura** funciona a partir de qualquer rota e leva de volta ao formulário na home;
- a home reduz o bloco de intenção para três decisões possíveis hoje: comprar, entender ou vender;
- uma faixa de transparência explica São Gabriel como praça inicial, o primeiro parceiro piloto em preparação e que o cadastro não cria pedido nem cobrança.

A navegação completa de pedido, rastreio, indicação e Clube reaparece automaticamente quando o mercado deixa o modo de pré-lançamento.

## Estado atual — v1.52 cloudflare production

O TAMÃO agora possui uma autoridade explícita de build para a futura publicação em Cloudflare Pages.

### Modos

- **lab** — GitHub Pages interno, comportamento atual;
- **cloudflare / noindex** — domínio oficial para pré-lançamento e anúncios, com crawling bloqueado;
- **cloudflare / indexável** — libera meta robots, robots.txt e sitemap de forma coerente;
- **cloudflare / live runtime** — somente para comércio real, exigindo origins HTTPS isoladas e Turnstile real.

### Segurança por resposta

O build Cloudflare gera `_headers` com CSP, `X-Frame-Options: DENY`, `nosniff`, Referrer-Policy, Permissions-Policy e cache restritivo para HTML, service worker e runtime config.

### Fail closed

O runtime real falha no build se:

- a origem pública não for HTTPS;
- `CHAMA_CUSTOMER_ORIGIN` não coincidir com `TAMAO_PUBLIC_ORIGIN`;
- faltarem as demais origins privilegiadas;
- a chave Turnstile for uma chave conhecida de teste.

A indexação orgânica pode ser ativada por variável depois da prova do domínio; anúncios de pré-lançamento podem operar antes disso, porque não dependem de crawling orgânico.

## Estado atual — v1.51 launch operations

O pré-lançamento agora possui um **pipeline operacional auditável** para evitar que aquisição vire apenas uma lista de contatos.

### Leads

Cada cliente ou parceiro captado pode avançar por:

- `new` — novo;
- `contacted` — contato realizado;
- `qualified` — interesse qualificado;
- `converted` — virou cliente/parceiro real;
- `closed` — encerrado.

O banco registra datas de contato, qualificação, conversão e encerramento. O admin mantém uma nota interna separada da mensagem enviada pelo próprio lead.

### Contato e LGPD

Solicitações públicas avançam por:

- `new`;
- `in_review`;
- `resolved`;
- `closed`.

Resolver ou encerrar exige documentação da solução no admin.

### Autoridade

As transições passam por RPCs `SECURITY DEFINER` exclusivos do `service_role`, exigem administrador válido, usam idempotência, bloqueiam regressões de estado e escrevem em `platform_admin_audit`.

## Estado atual — v1.50 trust & launch

A etapa de espera do domínio está sendo usada para fechar a superfície pública de confiança e lançamento.

- páginas públicas de **Privacidade**, **Termos** e **Contato**;
- canal server-only para dúvidas, suporte geral e solicitações LGPD;
- confirmação explícita de uso dos dados para resposta;
- honeypot, limite de payload, allowlist de origem e rate limit no endpoint público;
- solicitações aparecem no admin protegido;
- links de privacidade passam a acompanhar os formulários de cliente e parceiro;
- Supabase public endpoints usam o modelo atual de `SUPABASE_SECRET_KEYS` com fallback legado;
- build público unificado em `scripts/build-public-site.mjs`, adequado ao futuro Cloudflare Pages e ao GitHub Pages;
- `robots.txt` passa a ser incluído de fato no artefato publicado;
- runbook Cloudflare em `LAUNCH.md`;
- primeiras URLs/campanhas UTM em `MARKETING.md`.

O domínio **tamao.com.br** já foi adquirido. A troca de nameservers aguarda a janela operacional do Registro.br. Até DNS + HTTPS + formulários passarem na prova, o site público permanece `noindex` e nenhum anúncio pago deve apontar para o domínio.

## Estado atual — v1.49 acquisition

O pré-lançamento agora possui **captação real e mensurável** sem abrir o comércio antes da hora:

- clientes podem entrar na **lista de abertura** com WhatsApp, CEP e categorias de interesse;
- empresas podem registrar interesse como **Parceiro Fundador** em um formulário curto, sem exigir CNPJ no primeiro contato;
- UTM source/medium/campaign/content/term, referrer e landing path são preservados para medir campanhas;
- o endpoint público possui allowlist de origem, honeypot, consentimento explícito, validação, deduplicação e rate limit server-side;
- IP bruto não é persistido; o antiabuso usa somente hash server-side;
- leads ficam em tabela server-only, sem SELECT para anon/authenticated;
- o painel administrativo protegido recebe os leads e oferece atalho para contato via WhatsApp;
- pedido real continua sujeito aos gates de lançamento já existentes.

O domínio público pretendido é **tamao.com.br**. Enquanto DNS/hosting definitivo e portais isolados não forem comprovados, o GitHub Pages continua como laboratório interno e permanece fora de indexação.

## Estado atual — v1.48 TAMÃO

A marca pública do produto passa a ser **TAMÃO**, com a assinatura **“Pediu? Tá na mão.”** e o descritor inicial **“Gás, água e essenciais perto de você.”**. A mudança é deliberadamente **brand-first**: interface, PWA, portais live, notificações, documentação e testes passam a usar TAMÃO, enquanto identificadores técnicos legados como `CHAMA_*`, chaves de storage, nomes de crons e contratos server-side permanecem estáveis nesta versão para não romper sessões, deploys, automações ou migrações existentes. A migração desses identificadores internos deve ocorrer apenas em uma etapa técnica separada, com compatibilidade explícita.

A identidade visual v1.48 usa verde profundo, fundo quente e amarelo de confirmação, além de um símbolo de **mão + check** para materializar a promessa “tá na mão”. O repositório continua com o nome técnico `gassg` enquanto domínio e clearance marcário definitivo não estiverem formalmente concluídos.

## Online

**Pré-lançamento visual:** https://carloskk07.github.io/gassg/

A branch `main` é publicada no GitHub Pages somente depois dos gates automatizados. Essa origem compartilhada não recebe credenciais/origins do ambiente real e, portanto, **não aceita transações reais**.

Na origem dedicada do cliente, o modo padrão é real: não é necessário `?live=1`. Os portais privilegiados continuam separados:

- Cliente real: `#home` na origem `CHAMA_CUSTOMER_ORIGIN`
- Revenda real: `?merchant=1#merchant` na origem `CHAMA_MERCHANT_ORIGIN`
- Administração protegida: `?admin=1#admin` na origem `CHAMA_ADMIN_ORIGIN`

### Exemplos de pré-lançamento

Enquanto o backend ainda não tiver nenhuma revenda real **ativa, com compliance operacional vigente e pelo menos um item de catálogo ativo e precificado**, o cliente pode ver cards visuais marcados **“EXEMPLO — NÃO COMPRÁVEL”**.

Esses exemplos:
- não existem como merchant/order no banco;
- não podem acionar checkout, pagamento, cashback ou comissão;
- não restauram saldo, pedido ou revenda via browser storage;
- desaparecem automaticamente quando `market_supply_status()` detectar a primeira supply real configurada;
- não reaparecem se uma revenda real ficar temporariamente offline.

A suíte de testes mantém um marketplace sintético completo apenas quando injeta `globalThis.__CHAMA_TEST__=true`. A build normal não oferece esse caminho.

## Estado atual — v1.33 JR confirmed commercial range

O primeiro parceiro piloto agora possui uma faixa comercial P13 confirmada no staging server-only:

- mínimo autorizado: **R$ 115,90**;
- preço normal: **R$ 120,00**;
- máximo autorizado: **R$ 125,00**;
- entrega incluída;
- modo: **faixa automática**;
- estratégia inicial do motor: **Equilibrado**.

Isso **não ativa o JR como revenda real**. `onboarding_status` permanece `awaiting_legal_data`, `merchant_id` continua nulo e o registro não participa de matching, market supply ou criação de pedidos reais.

O laboratório interno foi alinhado à faixa confirmada. Estoque, ETA, distância, trust, aceite, pagamento e entrega continuam simulados.

## Estado atual — v1.32 merchant-authorized pricing range

A v1.32 substitui o preço único opcional por uma política por SKU controlada pela própria revenda.

Cada item pode operar em:

- **Preço fixo** — o TAMÃO usa exatamente o preço confirmado;
- **Faixa automática** — a revenda define **mínimo autorizado**, **preço normal**, **máximo autorizado** e uma estratégia:
  - Priorizar volume;
  - Equilibrado;
  - Priorizar margem.

O preço automático é calculado somente com sinais da **própria operação**: estoque disponível, quantidade solicitada, pedidos ativos e volume recente. A política de uma revenda **não lê nem copia preços de concorrentes**. Depois de cada revenda produzir sua oferta independente, o ranking normal compara preço final, ETA, confiança e carga para escolher Melhor / Mais barato / Mais rápido.

Invariantes:

- nunca abaixo do mínimo autorizado;
- nunca acima do máximo autorizado;
- preço normal sempre dentro da faixa;
- quote congela o preço efetivamente mostrado ao cliente;
- freshness por SKU e por taxa de entrega continua obrigatória;
- rows de catálogo são bloqueadas durante o snapshot;
- preço fora da faixa é rejeitado pelo RPC;
- o JR agora possui faixa comercial confirmada de **R$ 115,90 / R$ 120,00 / R$ 125,00** no staging; o GitHub Pages simula a operação usando essa faixa, sem ativar venda real.

O laboratório interno permite testar a faixa sem alterar a operação real do parceiro.

## Estado atual — v1.31 reliability, concurrency & boundary hardening

A v1.31 faz uma segunda auditoria de produção sobre segurança, concorrência, rede, matching e limites do banco.

Principais correções:

- sequências públicas antigas também são revogadas de `anon/authenticated`; o modelo server-only passa a cobrir tabelas, funções **e sequências**;
- a FK `pilot_partner_drafts.merchant_id` recebe índice de cobertura;
- cadastro de parceiro rejeitado pode ser corrigido e reenviado; cadastro aprovado não pode ser reaberto por corrida entre usuário e administrador;
- `submit-merchant-application` usa a origem dedicada da revenda;
- retries de falha ambígua reutilizam a mesma idempotency key em create-order, ações de cliente/revenda, entrega e admin; escritas de configuração repetíveis também recebem retry seguro;
- polling de cliente, revenda e admin é single-flight e descarta respostas obsoletas;
- desligar o atendimento em São Gabriel pausa a revenda; não existe mais estado visual ONLINE enquanto o matching a exclui;
- o matching deixa de cortar arbitrariamente as primeiras 40 revendas antes do ranking;
- preço unitário máximo fica em **R$ 10.000** nas camadas UI/API/Postgres para manter a maior cesta suportada dentro do `integer` de 32 bits;
- o simulador comercial não exibe contribuição/margem até o parceiro informar o custo do produto;
- o CI executa fuzz determinístico adicional e retry de CDN sem relaxar o SHA-384 exigido do Supabase JS;
- cache PWA sobe para `chama-sg-v1.31`.

No Supabase real, continuam existindo **0 merchants reais, 0 pedidos e 0 admins**, além de **1 rascunho comercial server-only** do primeiro parceiro. O GitHub Pages permanece laboratório interno; comércio real continua bloqueado até as origens dedicadas, Auth/Turnstile, primeiro admin, dados jurídicos/compliance do parceiro e E2E real multi-dispositivo serem comprovados.

## Estado atual — v1.30 merchant conversion

A v1.30 transforma a experiência de parceria de uma explicação de funcionalidades em uma proposta econômica para donos de revenda.

### Proposta comercial

A landing agora começa por **faturamento incremental**, sem sugerir exclusividade:

- TAMÃO como canal adicional a telefone, WhatsApp, balcão e canais próprios;
- sem obrigação de aceitar todo pedido;
- online/offline sob decisão da empresa;
- preço, estoque, taxa de entrega e catálogo controlados pela revenda;
- multiproduto apresentado como oportunidade de aumentar ticket por entrega.

### Simulador de margem incremental

O simulador antigo de “bruto - taxa” foi substituído por um modelo que recebe:

- pedidos adicionais;
- preço médio;
- custo do produto;
- custo médio de entrega;
- custo do meio de pagamento;
- tributos percentuais.

A saída separa vendas brutas, taxa TAMÃO, custos informados, contribuição total, contribuição por pedido e margem estimada. A interface deixa explícito que **receita não é lucro** e que o cálculo não conhece custos fixos nem promete rentabilidade.

### Distribuição de pedidos

A landing explica a política já implementada no backend:

- preço total, ETA e confiança operacional são sinais principais;
- menor carga não vence automaticamente;
- carga atual e volume recente só ajudam a distribuir entre parceiros de qualidade próxima;
- a revenda não precisa ser sempre a mais barata para participar.

### Financeiro e operação

A parceria passa a explicar:

- pedido, pagamento, conclusão e conciliação como etapas distintas;
- repasse ainda em validação operacional;
- recusar antes do aceite é permitido;
- aceitar e falhar depois é operacionalmente diferente;
- cashback, taxa da plataforma e ajustes são contas separadas.

### Parceiro Fundador

Foi criada a proposta **Parceiro Fundador — São Gabriel**, sem promessa de demanda ou renda:

- onboarding acompanhado;
- acesso antecipado às ferramentas;
- feedback direto nas melhorias;
- histórico de participação no piloto.

No GitHub Pages interno, o CTA principal é **Experimentar painel da revenda** e abre diretamente o cenário JR simulado, evitando um portal live ainda sem domínio.

## Estado atual — v1.29 internal full pilot

Como o TAMÃO ainda não está sendo divulgado e não possui domínio próprio, o GitHub Pages passou a funcionar como **laboratório interno completo**, sem abrir comércio real.

- somente no host `carloskk07.github.io/gassg/`, o runtime ativa `CHAMA_INTERNAL_PILOT`;
- esse modo usa o motor de simulação já auditado e **não chama create-order real**;
- o único fornecedor do cenário é **Gas e Lenheira do JR — SIMULAÇÃO**;
- P13 começa em **R$ 115,90 entregue**, único dado comercial carregado da conversa real;
- estoque, ETA, distância e trust são marcados como simulados e editáveis;
- cliente e revenda percorrem o fluxo inteiro: pedido → aceite → preparação → saída → chegada → pagamento → código → settlement → cashback;
- com um único fornecedor, a UI mostra **Disponível agora** e não inventa concorrência;
- a simulação não altera `merchants`, estoque, pedidos ou financeiro do Supabase real;
- GitHub Pages permanece proibido como origem live de customer/merchant/admin;
- a página recebe `noindex,nofollow,noarchive,nosnippet` e `robots.txt: Disallow: /` enquanto estiver em pré-lançamento.

O CI possui um segundo E2E específico para esse cenário e prova o fluxo JR até settlement e cashback.

## Estado atual — v1.28 first real merchant pilot

A v1.28 prepara a transição do pré-lançamento para o primeiro piloto operacional real.

### Primeiro parceiro em preparação

Foi criado um staging server-only para **Gas e Lenheira do JR** com os únicos dados comerciais já informados:

- produto inicial: P13;
- preço comercial proposto: **R$ 115,90 entregue**;
- preço ainda marcado como `proposed`;
- onboarding: `awaiting_legal_data`;
- nenhum CNPJ, ANP, owner, endereço ou dado jurídico foi inventado;
- o staging não cria merchant, não entra no matching e não muda `realSupplyConfigured`.

Enquanto os dados reais não forem cadastrados e validados, o mercado continua com **0 revendas reais** e os exemplos públicos permanecem não compráveis.

### Fornecedor único sem concorrência fictícia

Quando existir exatamente uma revenda elegível para uma cesta, `get-offers` devolve:

- uma única oferta;
- `marketMode=single_supplier`;
- rótulo público **Disponível agora**;
- nenhum card fictício de “mais barato/mais rápido” da mesma empresa.

A interface explica que há um único parceiro elegível naquele momento.

### Crescimento para várias revendas

Com duas ou mais revendas, o ranking continua customer-first:

1. preço total;
2. ETA;
3. trust;
4. carga ativa e volume recente apenas como desempate entre opções de qualidade próxima.

Carga não pode promover uma oferta claramente pior. O balanceamento só atua dentro de uma banda de qualidade de 0,10 do melhor score base. Isso permite dar oportunidade a parceiros novos sem sacrificar de forma artificial preço/prazo do comprador.

## Estado atual — v1.27 reliability & security hardening

A v1.27 ataca falhas que aparecem principalmente em produção, mesmo quando a jornada feliz já passa no navegador:

- todas as chamadas do frontend para Supabase/Edge Functions passam a ter **deadline de rede**;
- carregamento dinâmico do Supabase JS e Cloudflare Turnstile tem timeout e pode se recuperar de falha anterior;
- `create-order` reaproveita a **mesma chave idempotente** em retry de timeout/falha de transporte/5xx e tenta recuperar o pedido pelo servidor se o ACK se perder;
- `customer-summary` projeta o pedido ativo do próprio usuário para reconstruir a sessão sem consultar tabelas diretamente;
- o último pedido terminal continua persistido para reload, comprovante e suporte;
- navegação entre cliente/revenda/admin usa a raiz de cada origem HTTPS dedicada em vez de herdar o path do host anterior;
- o Service Worker usa cache também quando a origem same-origin responde erro e nunca resolve a resposta offline como `undefined`;
- `schema.sql` foi alinhado à arquitetura atual **server-only**, removendo grants/policies/Reatime legados que poderiam reabrir acesso direto ao browser em um bootstrap novo;
- defaults do PostgreSQL foram endurecidos para que novas tabelas, sequências e funções de `public` não nasçam acessíveis a `anon/authenticated`; PostgreSQL 17 `MAINTAIN` é revogado explicitamente;
- os gates passaram a provar essas propriedades e o E2E inclui timeout de rede com `AbortSignal`.

No banco real, os objetos atuais continuam com RLS e apenas `service_role` possui privilégios nas tabelas da aplicação. Os avisos `RLS Enabled No Policy` permanecem intencionais porque a arquitetura do piloto não usa PostgREST direto no browser.

## Estado atual — v1.26 human conversion & trust

A v1.26 reorganiza a experiência pública a partir da decisão real do usuário: **comprar primeiro, entender a confiança depois e só então explorar benefícios e oportunidades**. Nenhuma capacidade financeira ou operacional inexistente foi promovida como pronta.

Principais mudanças:

- a Home inicia pela compra do **Botijão de cozinha 13 kg**, mantendo `P13` apenas como referência técnica secundária;
- endereço, produto e CTA de consulta ficam juntos no primeiro bloco de decisão;
- preço total, previsão de entrega e aceite do parceiro passaram a usar linguagem de consumidor;
- cards reais continuam sem revelar a identidade completa do parceiro antes do aceite, mas explicam claramente total, prazo, elegibilidade, confiança e forma de pagamento;
- rescue/requote passa a ser apresentado como **Proteção TAMÃO**: se a primeira operação falhar antes da saída, o sistema pode procurar alternativa e qualquer aumento de total continua exigindo aceite explícito do cliente;
- acompanhamento usa **código de recebimento** como linguagem pública, preservando o PIN técnico no backend;
- cashback, comissão por indicação e receita de revenda são apresentados como três naturezas econômicas diferentes;
- o simulador de indicação continua preso à política real do piloto de **2% sobre a primeira compra qualificada** e deixa ainda mais explícito que comissão não é renda fixa nem saque imediato;
- a proposta para revendas continua expondo **7,5% por pedido concluído**, agora com FAQ sobre autonomia, taxa, catálogo e a ausência de prazo de repasse prometido enquanto cobrança/conciliação/payout não forem validados ponta a ponta;
- o pré-lançamento continua fail-closed: exemplos seguem marcados **EXEMPLO — NÃO COMPRÁVEL** e não criam pedidos, cobranças ou recompensas.

**Estado operacional permanece o mesmo:** o mercado real ainda tem 0 revendas configuradas e o GitHub Pages continua sendo somente uma prévia visual. A v1.26 melhora conversão e confiança; ela não remove os blockers de go-live listados abaixo.

## Estado atual — v1.25 conversion & transparent economics

**Backend multiusuário:** aplicado no projeto Supabase exclusivo do TAMÃO.

**Mercado real configurado neste momento:** 0 revendas. Por isso a prévia visual permanece ativa.

**Operação real:** tecnicamente preparada, mas ainda depende do onboarding e da validação ponta a ponta das primeiras revendas reais. O banco ainda não possui pedidos ou merchants de produção.

Antes de liberar usuários reais em volume, devem ser comprovados com contas reais:

1. login permanente da revenda e vínculo em `merchant_members`;
2. URLs de redirecionamento do Supabase Auth;
3. conversão de cliente anônimo para conta permanente por e-mail;
4. primeiro fluxo em dois dispositivos: cliente → revenda → entrega → pagamento + PIN → benefícios;
5. criar o primeiro administrador permanente pelo bootstrap server-side descrito abaixo;
6. processo operacional de cobrança/reembolso entre plataforma e revenda;
7. publicar cliente, revenda e admin em **três origens HTTPS distintas**;
8. configurar Cloudflare Turnstile e habilitar CAPTCHA/Turnstile no Supabase Auth antes de aceitar novas sessões;
9. comprovar os redirect URLs de magic link das origens de revenda e admin.

## Experiência pública v1.25

A camada comercial foi reorganizada para responder primeiro ao que o usuário precisa decidir:

- **Pedir agora:** preço e previsão de entrega antes da confirmação;
- **Economizar:** cashback e benefícios de compra separados de comissão;
- **Ganhar ou vender:** indicação de novos compradores e canal de vendas para empresas como propostas distintas.

A home agora prioriza preço, prazo, aceite real e rastreabilidade. Ofertas reais comunicam que a operação é elegível sem revelar a identidade da revenda antes do aceite. “A caminho” continua dependente de confirmação real de saída e a conclusão continua exigindo pagamento + PIN.

A economia pública também ficou ligada ao contrato financeiro do backend:

- indicação: simulador baseado na política inicial de **2% sobre a primeira compra qualificada de cada novo cliente elegível**;
- revenda: política inicial de **7,5% sobre o valor bruto de cada pedido concluído**, com simulador de vendas brutas, taxa TAMÃO e valor anterior aos custos/tributos próprios;
- exemplos são explicitamente ilustrativos e não são promessa de renda;
- saque Pix continua desabilitado até existir integração financeira real.

Os gates agora falham se a UX publicar 2% ou 7,5% enquanto a migration financeira versionada deixar de conter `direct_referral_bps=200` ou `platform_fee_bps=750`.

A prévia pública não ganhou formulário de captação aberto nesta rodada: o GitHub Pages continua fail-closed e o projeto exige proteção anti-bot/Turnstile e política de privacidade operacional antes de coletar contato real em uma origem pública.
## Experiência pública v1.23

A interface pública foi reorganizada em torno de três intenções de usuário:

- **Comprar:** consulta, cesta, comparação, aceite real da revenda e acompanhamento;
- **Entender:** rota `#learn` com funcionamento, segurança e perguntas frequentes;
- **Ganhar:** rota `#earn` separando indicação de compradores de venda por empresa/revenda.

A home agora apresenta essas três portas logo no início, explica o fluxo em quatro passos também no mobile e reduz jargão de infraestrutura. O programa de indicação mostra a regra atual do piloto de forma explícita e deixa claro que exemplos não são promessa de renda. O saque Pix ainda inexistente permanece desabilitado na interface.

A landing de revendas foi redesenhada para explicar autonomia comercial, catálogo multiproduto, online/offline, aceite por pedido, requisitos de cadastro e validação regulatória para GLP.

## Resiliência operacional v1.24

A auditoria v1.24 endureceu superfícies que só aparecem fora do fluxo feliz:

- navegação entre cliente, revenda e admin usa explicitamente as três origins configuradas, em vez de reutilizar a origin atual;
- contas vinculadas a várias revendas escolhem por padrão uma membership operacional (`owner`, `manager` ou `operator`);
- seleção de revenda persistida é apagada no logout e recuperada automaticamente quando ficou obsoleta ou pertenceu a outra conta;
- o papel `driver` continua bloqueado sem assignment, mas agora recebe uma explicação específica na UI;
- cashback e comissões são resincronizados periodicamente mesmo sem pedido ativo, com throttle de 60 segundos;
- falha temporária do `market-status` não é apresentada como falsa ausência de parceiros;
- a revenda deixa de aparecer como **ONLINE** quando o heartbeat já ficou velho;
- indicação foi alinhada ao contrato financeiro: uma comissão de aquisição sobre a **primeira compra qualificada de cada novo cliente elegível**; compras repetidas do mesmo indicado não geram nova comissão.

O programa de indicação continua usando a política inicial de **2%**, respeitando hold, validação de risco e os gates de identidade permanente definidos no backend.

## O que já existe

### Cliente

- PWA mobile-first;
- Anonymous Auth no piloto para reduzir atrito;
- consulta de ofertas reais por Edge Function;
- cesta multiproduto sem obrigar P13;
- GLP P1–P90 suportado server-side; P13/P20/P45 ficam no catálogo base e outros tamanhos configurados por revendas reais são materializados dinamicamente no cliente;
- água, carvão, lenha e gelo como SKUs essenciais não-GLP;
- preço e itens congelados em quote server-side;
- ofertas “Recomendado”, “Mais barato” e “Mais rápido” sem revelar a revenda;
- apenas um pedido ativo por cliente;
- re-cotação mais cara somente com aceite explícito;
- tracking server-side;
- PIN mostrado somente após saída real;
- cashback, fidelidade e indicação;
- conversão da conta anônima para identidade permanente sem trocar `user_id`.

### Revenda

- portal real separado da sessão do cliente;
- login passwordless por e-mail;
- sessão da revenda limitada ao `sessionStorage` da aba e aceita somente na origem dedicada configurada;
- somente `owner`, `manager` e `operator` podem operar pedidos no piloto;
- papel `driver` permanece bloqueado até existir atribuição por pedido;
- endereço do cliente oculto antes do aceite;
- online/offline e heartbeat;
- preço/estoque por SKU, incluindo cilindros GLP P1–P90;
- taxa de entrega e ETA;
- aceite, recusa, rescue pós-aceite, saída, chegada e conclusão;
- conclusão exige **pagamento confirmado + PIN correto**.

### Administração

- control plane real em `?admin=1#admin`;
- sessão própria, separada de cliente e revenda;
- login não cria conta automaticamente;
- autorização por allowlist `platform_admins`, nunca por `user_metadata`;
- aprovação de cadastro cria merchant `pending` e vincula o solicitante como `owner`, sem ativação automática;
- CNPJ verificado é obrigatório para ativação;
- qualquer GLP ativo P1–P90 exige também ANP verificada;
- conciliação de taxa, cashback e ajustes de reversão;
- reversão financeira e auditoria são atômicas no Postgres.

### Backend e segurança

O navegador não possui acesso direto às tabelas da aplicação. RLS permanece ativo e os grants/policies de `anon/authenticated` foram removidos do data-plane; toda leitura/escrita real passa por projeções ou autoridades Edge server-side.

Edge Functions atuais:

- `get-offers`
- `create-order`
- `get-order`
- `customer-action`
- `customer-summary`
- `market-status`
- `merchant-orders`
- `merchant-action`
- `merchant-ops`
- `complete-delivery`
- `submit-merchant-application`
- `admin-ops`

Proteções implementadas:

- JWT validado em todas as Edge Functions;
- publishable key no browser; secret/service role nunca no frontend;
- dependências fixadas em versão;
- payload JSON limitado a 16 KB, inclusive streaming/chunked;
- quotas atômicas por usuário;
- idempotência de mutações;
- optimistic concurrency por `version`;
- snapshots atômicos de quote;
- rescue centralizado;
- preço, taxa e itens congelados em re-cotação;
- PIN com `pgcrypto`, cinco tentativas e retenção curta;
- service worker network-first com cache `v1.25`;
- estado live com endereço/carrinho permanece em `sessionStorage`;
- identidade anônima do cliente + ID do pedido ativo persistem na **origem dedicada do cliente**, permitindo recuperar uma entrega após fechar o navegador;
- revenda e admin continuam tab-scoped em `sessionStorage`;
- GitHub Pages funciona somente como pré-lançamento visual; transações reais exigem origens HTTPS dedicadas;
- novas identidades anônimas e magic links passam por Cloudflare Turnstile antes de chamar o Supabase Auth.

## Confirmações de credibilidade do pedido

O sistema não avança por inferência de interface:

`OFFERED_TO_MERCHANT → PREPARING → OUT_FOR_DELIVERY → ARRIVING → SETTLED`

Cada mudança exige autoridade server-side. “A caminho” só aparece depois de `dispatch`; “Concluído” exige pagamento confirmado e PIN correto.

Se a revenda aceita e depois não consegue concluir, `cannot-fulfill` devolve o estoque reservado e inicia rescue atômico. Se a alternativa for mais cara, o cliente precisa aceitar a nova condição dentro da janela de re-cotação.

## Modelo financeiro v1.6

A unidade econômica é congelada na criação de cada pedido. Política inicial do piloto:

- taxa da plataforma: **7,5%** do valor bruto;
- reserva de custo variável: **0,75%**;
- contribuição mínima da plataforma: **2,5%**;
- cashback alvo: **1,0%**;
- indicação direta alvo: **2,0%**, apenas para aquisição do cliente;
- hold de comissão: **168 horas**.

Cashback e comissão são limitados pela receita real da plataforma. O banco possui constraint que impede os benefícios de romperem a contribuição mínima.

Quando cashback antigo é usado, o cliente paga menos, mas a revenda continua tendo direito ao valor cheio. Por isso o backend registra separadamente:

- taxa da plataforma a receber;
- cashback resgatado a reembolsar à revenda;
- ajustes de reversão;
- posição financeira líquida por revenda.

Comissão pode ficar pendente para um usuário anônimo, mas só amadurece para saldo disponível depois que o mesmo `user_id` vira identidade permanente.

## Reversões

Entrega operacional e liquidação financeira são estados diferentes. Um pedido entregue pode permanecer no histórico como `SETTLED` e depois ter `financial_state=reversed`.

Uma reversão server-side:

- estorna cashback concedido;
- retira comissão pendente ou disponível;
- reabre a elegibilidade da indicação quando aplicável;
- reverte a taxa da plataforma;
- trata reembolso de cashback já pago à revenda;
- mantém trilha de auditoria e é idempotente.

## Jobs automáticos

- `chama-order-watchdog`: a cada minuto;
- `chama-reward-maturation`: a cada hora;
- `chama-reward-retry`: a cada 5 minutos;
- `chama-settlement-accounting-retry`: a cada 5 minutos;
- `chama-data-retention`: diariamente;
- `chama-anonymous-cleanup`: diariamente;
- `chama-compliance-expiry`: diariamente.

Usuários anônimos só são eliminados após 45 dias se não possuírem pedido, carteira, indicação, cadastro de revenda, membership ou identidade vinculada.

## Gates de release

O CI executa:

- sintaxe/checagem das Edge Functions;
- integridade SHA-384 do SDK browser do Supabase;
- simulações de domínio, concorrência e falhas;
- auditoria estática;
- contratos SQL/migrations;
- contratos de runtime;
- smoke em Chrome móvel;
- E2E completo em Chrome;
- validação do manifest/PWA.

O workflow **Audit** roda também no SHA final de `main`, e o deploy do Pages repete os gates antes de publicar.

Nenhuma mudança deve ir para `main` com gate vermelho.

### Bootstrap do primeiro administrador

O banco começa deliberadamente com zero administradores. Depois que a primeira conta permanente de administração existir no Supabase Auth, execute **uma única vez**, pelo SQL Editor/service role:

`select public.bootstrap_first_platform_admin('<UUID-DA-CONTA-PERMANENTE>'::uuid);`

A função falha se a conta for anônima e fecha automaticamente assim que existir um administrador ativo. A partir daí, novos administradores são gerenciados pelo próprio control plane; o banco impede desativar o último administrador ativo.

## Limites deliberados do piloto

Ainda não são considerados concluídos:

- onboarding das três revendas reais e validação regulatória;
- geocodificação/roteamento real por rua em vez do escopo cidade;
- PSP/split/Pix payout automatizado;
- saque real de comissão;
- atribuição individual de motorista;
- bootstrap do primeiro administrador;
- configuração externa do Auth: Anonymous Sign-Ins, CAPTCHA Turnstile com secret, Site URL e redirect URLs;
- configuração de `CHAMA_CUSTOMER_ORIGIN`, `CHAMA_MERCHANT_ORIGIN`, `CHAMA_ADMIN_ORIGIN` e `CHAMA_TURNSTILE_SITE_KEY`;
- origens dedicadas/custom domains para cliente, revenda e admin antes de escalar o piloto;
- WhatsApp/push de produção;
- contratos, termos, privacidade e procedimento operacional final.

Veja também [AUDIT.md](./AUDIT.md), [supabase/README.md](./supabase/README.md), [supabase/API.md](./supabase/API.md) e [supabase/THREAT_MODEL.md](./supabase/THREAT_MODEL.md).
