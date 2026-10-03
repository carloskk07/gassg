# Auditoria — TAMÃO

Data: 02/10/2026

## Status

**READY_FOR_PROTECTED_ONLINE_PILOT**

A arquitetura multiusuário, o banco, as Edge Functions, os jobs e os gates de release estão implantados. O GitHub Pages continua sendo somente a prévia de pré-lançamento e falha fechado para transações reais.

**NOT_YET_APPROVED_FOR_PUBLIC_REAL-MONEY LAUNCH**

O bloqueio restante é operacional, não uma falha arquitetural já conhecida: ainda não existem administrador permanente, revenda real, usuário real, pedido real nem um E2E multi-dispositivo de produção. Cliente, revenda e admin também precisam das três origens HTTPS dedicadas e da configuração externa de Auth/Turnstile antes do go-live.

Na verificação desta rodada, o banco de produção permanecia com **0 usuários, 0 pedidos, 0 revendas, 0 memberships, 0 aplicações e 0 administradores reais**.

## Release auditado

- SHA funcional da v1.25: `cc7ba7f870e86e6d6d2c2a14b91af5aa86e89995`;
- PR #16 integrada por squash;
- workflow **Audit** aprovado no SHA funcional já integrado em `main`;
- workflow **Deploy to GitHub Pages** aprovado no mesmo SHA, incluindo smoke mobile, E2E completo, manifest, staging, upload e deploy;
- esta rodada não alterou schema, migration, Edge Function, RLS, grants ou configuração do Supabase;
- a infraestrutura Supabase validada na v1.24 permanece como base operacional desta release.

## Evolução comercial v1.25

A rodada v1.25 tratou a interface como uma superfície de decisão comercial, mantendo intactas as autoridades server-side de pedido, segurança e finanças.

Mudanças:

- home reposicionada para **preço + prazo + confiança**, em vez de explicação de produto como intenção principal;
- portas principais alteradas para **Pedir agora / Economizar / Ganhar ou vender**;
- ofertas reais comunicam **operação elegível**, preservando o sigilo da identidade da revenda antes do aceite;
- indicação ganhou simulador interativo ancorado em `REFERRAL_PILOT_RATE=0.02`, sempre acompanhado de aviso de que não é promessa de renda;
- landing de revenda passou a expor a política inicial de **7,5% por pedido concluído** e um simulador comercial de bruto, taxa e valor antes de custos/tributos próprios;
- saque Pix continua visualmente e funcionalmente indisponível;
- título/descrição SEO e cache da PWA foram alinhados à nova proposta;
- smoke/E2E foram atualizados para provar as novas jornadas e simuladores em Chrome;
- auditoria estática liga os números públicos de 2% e 7,5% à migration financeira `20261001105000_financial_unit_economics_v1_6.sql`, reduzindo risco de divergência futura entre marketing e backend.

Não foram alterados nesta rodada: máquina de estados, matching, RLS, grants, política financeira do Postgres, pagamentos, payout ou privilégios administrativos.

A captação pública de contatos de pré-lançamento continua deliberadamente bloqueada até existir proteção anti-bot/Turnstile e política de privacidade operacional. O GitHub Pages permanece uma origem visual fail-closed.
## Evolução de experiência v1.23

A rodada v1.23 olhou o produto como três usuários diferentes: quem quer comprar, quem quer entender e quem quer gerar renda.

Mudanças comprovadas:

- home reorganizada em **Comprar / Entender / Gerar renda**;
- nova rota `#learn` com passo a passo, confiança e FAQ;
- nova rota `#earn` distinguindo indicação pessoal de parceria comercial;
- programa de indicação com regra do piloto explicada e exemplos marcados como não garantidos;
- saque Pix inexistente removido como ação aparentemente disponível e mantido desabilitado;
- landing de revenda refeita para aquisição, autonomia operacional e requisitos;
- navegação desktop e mobile atualizadas para tornar “Ganhe” uma jornada de primeira classe;
- linguagem técnica de backend/origem removida das principais superfícies do comprador;
- nova linguagem visual com cards de intenção, resumo do fluxo, oportunidades e FAQ;
- service worker atualizado para cache v1.23.

Os gates de browser passaram a cobrir também `home`, `learn`, `earn`, compra, clube, indicação e revendas em viewport móvel. O E2E continua provando o fluxo operacional completo depois da mudança de UX.

## Hardening de resiliência v1.24

A rodada atacou estados que normalmente escapam do E2E feliz.

### 1. Portais em origins dedicadas

Os botões de navegação construíam `?merchant=1` e `?admin=1` sobre a origin atual. Em produção isso podia enviar o usuário para o portal privilegiado na origin do cliente, que era corretamente rejeitada pelo próprio fail-closed.

Correção:

- autoridade única `buildPortalHref()`;
- cliente → revenda usa `CHAMA_MERCHANT_ORIGIN`;
- revenda/admin → cliente usa `CHAMA_CUSTOMER_ORIGIN`;
- entrada admin usa `CHAMA_ADMIN_ORIGIN`;
- localhost continua suportado para desenvolvimento;
- E2E prova as quatro combinações relevantes de routing.

### 2. Conta multi-revenda e seleção persistida

`merchant-orders` usava a primeira membership retornada pelo banco. Uma conta com `driver` em uma revenda e `owner/manager/operator` em outra podia receber 403 dependendo da ordem da consulta.

Além disso, o merchant selecionado ficava no `localStorage` depois do logout e podia bloquear a conta seguinte.

Correção:

- seleção default prefere membership operacional;
- seleção explícita continua respeitada e pode ser negada semanticamente;
- logout limpa a seleção persistida;
- seleção obsoleta/sem autorização é apagada e resolvida novamente uma única vez;
- UI distingue `MERCHANT_ROLE_NOT_ENABLED` de “revenda ainda não vinculada”.

### 3. Estado financeiro vivo

O resumo financeiro só era sincronizado no bootstrap e ao terminar um pedido. Cashback/comissão podiam permanecer stale se uma chamada falhasse ou se uma comissão amadurecesse pelo job enquanto a PWA permanecia aberta.

Correção:

- polling financeiro periódico com throttle de 60 s;
- sincronização forçada após `SETTLED/CANCELLED`;
- atualização funciona mesmo sem pedido ativo;
- quota server-side permanece muito acima da frequência utilizada.

### 4. Estado de mercado desconhecido

Falha temporária de `market-status` podia ser mostrada como “Chegando em breve”, confundindo “não consegui consultar” com “não existem parceiros”.

Correção:

- estado `ready + marketStatus=null` é tratado como disponibilidade desconhecida;
- usuário continua podendo consultar diretamente pelo endereço;
- exemplos de pré-lançamento continuam exigindo prova explícita de `realSupplyConfigured=false`.

### 5. Heartbeat verdadeiro da revenda

Uma operação marcada `online=true` podia continuar exibindo “ONLINE” mesmo quando `last_seen_at` já estava velho o suficiente para o matching parar de enviar pedidos.

Correção:

- falha de heartbeat é preservada no runtime;
- polling renova heartbeat antes de atualizar a projeção;
- painel exibe **SEM CONEXÃO** quando a presença já não é recente;
- novos pedidos continuam protegidos pelo gate server-side de `last_seen_at`.

### 6. Contrato de indicação

A UX v1.23 dizia “10 compras de R$ 120”, o que podia sugerir comissão recorrente sobre compras repetidas do mesmo indicado. O backend, porém, usa indicação como aquisição: a relação nasce antes do primeiro pedido e qualifica uma primeira compra elegível.

Correção:

- exemplos agora usam “novos clientes / 1ª compra”;
- compras repetidas do mesmo indicado são explicitamente excluídas de nova comissão de aquisição;
- UX registra que maturação exige as identidades permanentes previstas no backend;
- testes ligam o texto público ao `direct_referral_bps=200`, ao acquisition gate e ao risk/identity gate.

## Prova transacional v1.24

Foi executado cenário no Postgres real dentro de `BEGIN ... ROLLBACK`:

- revenda sintética não-GLP com CNPJ vigente e ANP pendente;
- `merchant_anp_compliance_current()` retornou verdadeiro enquanto não havia GLP;
- operação não-GLP pôde ficar ativa;
- tentativa de P20 ativo sem ANP foi bloqueada por `ANP_REVERIFICATION_REQUIRED`;
- após ANP verificada com referência, P20 foi aceito;
- CNPJ e ANP ficaram vigentes no cenário válido;
- rollback posterior confirmou **0 merchants, 0 catálogo e 0 compliance sintéticos persistidos**.

## Evidência automatizada

A suíte verde cobre:

- sintaxe de JavaScript;
- Deno check e auditoria de secrets das Edge Functions;
- simulações de marketplace, concorrência e falhas;
- auditoria estática de assets, confiança e superfícies privilegiadas;
- contratos de schema, migrations e runtime;
- simulações server-side;
- smoke em Chrome mobile;
- E2E em Chrome: cesta → pedido → aceite → saída → chegada → pagamento + PIN → cashback;
- manifest e service worker;
- verificação SHA-384 do SDK browser do Supabase antes do release.

## Achados históricos v1.22 preservados

### 1. Divergência crítica de produtos GLP

O portal da revenda aceitava conceitualmente cilindros **P1–P90**, enquanto três constraints antigas do Postgres e a normalização do `get-offers` ainda eram P13-only/fixed-list. Na prática, P20/P45 exibidos pela interface poderiam falhar no backend, e outros GLPs cadastráveis pela revenda ficariam incompráveis.

Correção v1.22:

- `catalog_items`, `quote_items`, `order_items` e `order_requote_items` aceitam os SKUs fixos não-GLP e GLP **P1–P90**;
- `normalizeItems()` usa uma autoridade explícita de SKU e rejeita P0/P91+;
- o cliente materializa dinamicamente GLPs reais retornados por `market_supply_status()`;
- P20/P45 continuam disponíveis no catálogo base;
- os gates ANP e de compatibilidade logística continuam sendo aplicados a qualquer GLP, não apenas P13;
- testes de regressão cobrem P1, P20, P45, P90 e rejeição de P91.

### 2. Integridade do SDK browser

A versão do `@supabase/supabase-js` estava fixada, mas o carregamento dinâmico pelo CDN não aplicava SRI.

Correção v1.22:

- URL fixada no arquivo UMD exato `2.117.2/dist/umd/supabase.js`;
- `integrity` SHA-384 é aplicado antes de anexar o script;
- `crossOrigin=anonymous` permanece obrigatório;
- CI baixa o arquivo real do CDN e compara o SHA-384 esperado;
- o mesmo gate está presente no Audit e no deploy do Pages.

### 3. Lacuna de governança do CI

O workflow Audit não rodava em pushes para `main`; o Pages repetia a suíte, mas o SHA final de merge não recebia um status canônico do Audit.

Correção v1.22:

- Audit agora roda também em push para `main`;
- Pages mantém o gate completo antes do deploy;
- o primeiro SHA pós-correção passou nos dois workflows.

### 4. Documentação operacional desatualizada

README/AUDIT ainda citavam P13-only, cache v1.21 e uma lista incompleta dos jobs. A documentação foi alinhada ao estado v1.22 para reduzir risco de operação/go-live baseada em premissas antigas.

## Prova transacional no Supabase real

Foi executado um cenário dentro de transação com rollback:

- revenda sintética criada como `pending`;
- compliance CNPJ/ANP válido exigido antes da ativação;
- uma primeira tentativa sem `anp_reference` foi corretamente bloqueada pelo CHECK de compliance;
- com evidência ANP válida, P20, P45 e P90 ativos foram aceitos;
- P91 foi deliberadamente tentado e corretamente rejeitado pelo CHECK de `product_code`;
- `is_glp_product_code()` foi validado nos limites P1/P20/P45/P90 vs. P0/P91;
- a transação foi revertida;
- verificação posterior confirmou **0 registros de auditoria persistidos**.

## Segurança do banco

Estado pós-v1.24:

- 32 tabelas públicas da aplicação com RLS ativo;
- 0 policies nessas tabelas de data-plane;
- 0 grants diretos para `anon`, `authenticated` ou `public`;
- 0 funções públicas da aplicação executáveis por browser;
- funções `SECURITY DEFINER` protegidas e com `search_path` restrito;
- todas as 12 Edge Functions ativas exigem JWT;
- os 12 entrypoints publicados correspondem aos entrypoints do `main`;
- nenhum `service_role`/secret é exposto no frontend.

Os 32 avisos `RLS Enabled No Policy` do Security Advisor continuam sendo **INFO intencional**: o browser não possui grants e a arquitetura é server-only. Os dois warnings do schema `cron` são do `pg_cron` gerenciado.

## Evidência operacional pós-deploy

Após o deploy v1.24:

- `merchant-orders` v11 permaneceu **ACTIVE** e com JWT obrigatório;
- os três arquivos do bundle v11 foram comparados byte a byte com o `main` e coincidiram;
- os 12 entrypoints Edge ativos foram comparados com o `main` e coincidiram;
- não existiam falhas abertas em `reward_processing_failures` nem em `settlement_accounting_failures`;
- não existiam reviews de indicação pendentes;
- os jobs observados na janela de 24 h registraram somente execuções `succeeded`;
- o banco permaneceu sem usuários, merchants, memberships, aplicações, pedidos ou administradores de produção.

A consulta unificada de logs do provedor retornou erro do próprio endpoint nesta rodada; por isso a auditoria não usa ausência de linhas de log como prova de saúde. A evidência operacional acima vem de estado do banco, cron, filas e funções publicadas.

## Performance Advisor

Os avisos restantes são índices ainda não utilizados. Como o banco ainda não possui tráfego/pedidos reais, isso não é evidência para removê-los. A decisão deve ser tomada depois do piloto com estatísticas de uso.

## Jobs ativos

- `chama-order-watchdog`: a cada minuto;
- `chama-reward-retry`: a cada 5 minutos;
- `chama-settlement-accounting-retry`: a cada 5 minutos;
- `chama-reward-maturation`: horário;
- `chama-data-retention`: diário;
- `chama-anonymous-cleanup`: diário;
- `chama-compliance-expiry`: diário.

## Proteções críticas preservadas

### Pedido e concorrência

- quote + itens são snapshot atômico;
- revalidação ocorre na criação do pedido;
- preço/estoque/compliance/compatibilidade são rechecados;
- idempotência e optimistic concurrency por `version`;
- apenas um pedido ativo por cliente;
- rescue recompõe estoque;
- requote mais caro exige aceite explícito;
- watchdog cobre offer timeout, requote, preparação e ETA.

### Entrega

- endereço protegido antes do aceite;
- “saiu para entrega” exige ação explícita da revenda;
- PIN criptograficamente aleatório, armazenado com hash;
- cinco falhas bloqueiam o PIN;
- settlement exige **pagamento confirmado + PIN correto**;
- PAYMENT_CONFIRMED, DELIVERED e SETTLED continuam eventos distintos.

### Financeiro

- rewards nascem de SETTLED real;
- economia do pedido é congelada em snapshots;
- ledger possui tipos fechados;
- cashback usado e taxa da plataforma são contas separadas;
- reversões são idempotentes e auditadas;
- comissão tem hold e identidade permanente para amadurecimento;
- filas de retry e dead-letter existem para rewards e contabilidade de settlement.

## Dependências operacionais antes do primeiro pedido real

1. criar a primeira conta permanente de administrador e executar o bootstrap protegido;
2. configurar as três origens HTTPS dedicadas para cliente, revenda e admin;
3. configurar no Supabase Auth Site URL, redirect URLs, Anonymous Auth/Manual Linking e Turnstile;
4. cadastrar e aprovar a primeira revenda real;
5. validar CNPJ e ANP quando houver GLP;
6. cadastrar catálogo, estoque, ETA e taxa reais;
7. criar conta permanente do operador/owner;
8. executar E2E real em pelo menos dois dispositivos;
9. conferir order events, ledger, receivables, cashback reimbursement e admin audit;
10. documentar o processo de cobrança da taxa da plataforma e reembolso de cashback;
11. só então liberar usuários reais em volume.

## Limites deliberados do piloto

Ainda não são considerados concluídos:

- PSP/split/Pix payout automatizado;
- saque real de comissão;
- assignment individual de motorista;
- geocodificação/roteamento por rua;
- automação WhatsApp/push;
- Trust Score calibrado com tráfego real;
- termos/contratos/política LGPD final;
- E2E real multi-dispositivo e onboarding de revendas.

## Regra de release

Nenhuma mudança deve chegar a `main` com gate vermelho. O primeiro go-live de dinheiro real exige, além de CI verde, **origens dedicadas + Auth/Turnstile comprovados + revenda real + E2E multiusuário com evidência no Supabase**.


---

# Auditoria v1.26 — Human Conversion & Trust

## Objetivo

Revisar o TAMÃO como um usuário que chega com três intenções diferentes — **comprar**, **entender** e **gerar benefício/receita** — sem relaxar os contratos financeiros, operacionais e de segurança já existentes.

## Mudanças aprovadas

### Compra primeiro

- a Home passa a oferecer o botijão de cozinha de 13 kg em linguagem humana;
- `P13` permanece como referência técnica secundária, sem governar a comunicação principal;
- endereço e CTA de consulta ficam no primeiro bloco;
- a hierarquia passa a ser **comprar → confiar → benefícios → oportunidades**.

### Proteção TAMÃO

A lógica de rescue/requote já existente no backend ganhou uma tradução pública clara:

- pedido enviado não equivale a entrega confirmada;
- parceiro precisa aceitar;
- “A caminho” continua dependendo de saída real;
- se houver falha antes da saída, o sistema pode procurar outra opção elegível;
- alternativa com total maior continua exigindo autorização explícita do cliente.

Nenhuma nova autoridade foi criada no frontend. A UX apenas explica contratos server-side já existentes.

### Linguagem de consumidor

Foram reduzidos rótulos internos no caminho principal:

- “P13” → “Botijão de cozinha 13 kg” na comunicação pública;
- “PIN” → “código de recebimento” para o cliente;
- “operação/revenda” → “parceiro” onde a precisão técnica não é necessária;
- “Preço protegido” → “Total protegido” no acompanhamento.

Os identificadores e estados internos permanecem inalterados.

### Benefícios e geração de renda

A v1.26 separa explicitamente:

1. **cashback:** crédito para reduzir compras futuras;
2. **comissão por indicação:** política atual de 2% sobre a primeira compra qualificada de novo cliente elegível;
3. **receita da revenda:** vendas reais da própria empresa pelo marketplace.

A interface não promete renda fixa, não remunera recrutamento e não apresenta saque/Pix como disponível antes da integração real.

### Revendas

A landing comercial preserva a política inicial de **7,5% sobre o valor bruto de cada pedido concluído** e acrescenta respostas sobre:

- autonomia de aceite;
- preço, estoque, prazo e taxa de entrega;
- online/offline;
- catálogo multiproduto;
- estado ainda não comprovado do fluxo de cobrança, conciliação e repasse.

Nenhum prazo de repasse foi inventado.

## Gates adicionados/atualizados

- Home deve conter a entrada de compra em linguagem humana;
- Home deve apresentar Proteção TAMÃO;
- jornada deve preservar as três portas: pedir, entender e ganhar/vender;
- cache PWA sobe para `chama-sg-v1.26`;
- E2E browser passa a validar a nova linguagem pública sem alterar o cenário operacional de compra → aceite → saída → chegada → pagamento + código/PIN → cashback.

## Estado real após esta mudança

Esta rodada **não altera o readiness operacional**:

- 0 revendas reais configuradas;
- GitHub Pages continua pré-lançamento visual;
- exemplos continuam não compráveis;
- payout/saque real continua indisponível;
- primeiro E2E real multi-dispositivo ainda é obrigatório;
- origens dedicadas, Auth/Turnstile e onboarding da primeira revenda continuam sendo blockers do go-live.

A regra permanece: UX mais convincente não pode ser usada para mascarar ausência de operação real.


---

# Auditoria v1.27 — Reliability & Security Hardening

## Escopo

Auditoria pós-v1.26 com foco em falhas difíceis de reproduzir na jornada feliz:

- rede lenta ou pendurada;
- ACK perdido após mutação já confirmada pelo servidor;
- reload durante/apos pedido;
- drift entre Edge Functions publicadas e módulos compartilhados;
- privilégios futuros do Data API;
- PostgreSQL 17;
- PWA offline/degradação de origem;
- cron/retries;
- invariantes de dados e contabilidade;
- segurança de rendering e portais dedicados.

## Falhas e riscos encontrados

### 1. Privilégios padrão futuros ainda permissivos

As 32 tabelas da aplicação estavam corretamente fechadas para browser, mas o default ACL de `postgres` ainda poderia conceder privilégios automaticamente a `anon/authenticated` em novos objetos.

Correção aplicada no Supabase real e versionada:

- revogar CRUD/REFERENCES/TRIGGER de novas tabelas;
- revogar USAGE/SELECT/UPDATE de novas sequences;
- revogar EXECUTE de novas funções;
- manter `service_role` explícito;
- revogar também `MAINTAIN`, privilégio distinto do PostgreSQL 17.

A primeira tentativa também tentou alterar defaults de `supabase_admin` e foi corretamente recusada pelo provedor. A inspeção de ownership confirmou que os objetos TAMÃO em `public` pertencem a `postgres`, então a migration final atua apenas sobre a autoridade correta.

### 2. Baseline `schema.sql` contradizia o runtime atual

O baseline ainda criava grants SELECT/policies de leitura e publicação Realtime, embora o produto atual declare data-plane server-only e use polling por Edge Functions.

Correção:

- baseline não concede acesso direto a `anon/authenticated`;
- nenhuma policy browser-facing é recriada;
- Realtime publication não é reaberta pelo baseline;
- defaults fail-closed passam a fazer parte do contrato inicial.

### 3. Requisições poderiam ficar penduradas indefinidamente

`fetch` das Edge Functions e o fetch interno do Supabase JS não tinham deadline explícito.

Correção:

- `chamaFetch` com timeout de 15 s;
- `AbortController`;
- erro explícito `NETWORK_TIMEOUT`;
- cliente, revenda e admin usam o mesmo contrato;
- o E2E simula uma rede que só rejeita quando recebe `AbortSignal`.

### 4. Loaders externos podiam ficar permanentemente quebrados

Uma falha inicial ao carregar Supabase JS ou Turnstile deixava a Promise rejeitada em cache.

Correção:

- timeout do loader;
- limpeza do script falho;
- reset da Promise;
- nova tentativa posterior permitida.

### 5. ACK perdido em create-order

Cenário: banco cria o pedido, mas o navegador perde a resposta. Sem recuperação, o cliente poderia acreditar que falhou e tentar novamente.

Correção:

- chave idempotente criada antes da primeira tentativa;
- timeout, falha de transporte e 5xx repetem uma vez com a mesma chave;
- se ainda falhar, `customer-summary` procura o pedido ativo do próprio usuário;
- o cliente restaura `orderId` e abre tracking;
- nenhuma leitura direta de `orders` foi reintroduzida no browser.

### 6. Persistência do último pedido terminal

Durante a implementação da recuperação, um teste de revisão encontrou uma regressão antes do merge: a sincronização financeira limparia o último pedido ao não haver ativo.

Correção:

- pedido ativo do servidor substitui o ID local quando existe;
- ausência de ativo não apaga o último SETTLED/CANCELLED;
- isso preserva reload, comprovante e suporte;
- um novo pedido posteriormente substitui a referência normalmente.

### 7. Navegação cross-origin herdava path

Ao sair de um host em `/gassg/`, cliente/revenda/admin podiam herdar esse path em um custom domain que serve o app na raiz.

Correção:

- produção sempre começa em `/` da origem dedicada;
- localhost continua preservando o path de desenvolvimento;
- testes cobrem as três direções.

### 8. Service Worker não usava cache em HTTP 5xx

O network-first anterior só fazia fallback se `fetch` rejeitasse. Um 500/503 same-origin era devolvido mesmo se houvesse versão válida em cache.

Correção:

- `networkFirst()`;
- resposta `!ok` consulta cache antes de propagar o erro;
- falha de rede consulta cache;
- se ambos falharem, retorna `Response.error()`, nunca `undefined`.

### 9. Drift de bundle entre Edge Functions

Comparação da implantação mostrou que `get-offers` já carregava o `_shared/domain.js` canônico, enquanto várias outras funções tinham entrypoint correto, mas bundle compartilhado antigo. `customer-summary` também precisa do novo entrypoint desta versão.

Release gate:

- após merge, redeploy das funções afetadas com os módulos compartilhados do mesmo SHA;
- manter `verify_jwt=true`;
- comparar novamente entrypoint + shared bundle após deploy.

## Verificação do banco real

No momento desta auditoria:

- 0 merchants;
- 0 pedidos;
- 0 quotes;
- 0 wallet entries;
- 0 referrals;
- 0 aplicações;
- 0 admins;
- 0 estados impossíveis;
- 0 pedidos ativos duplicados;
- 0 órfãos em items/events/wallet;
- 0 settlements sem pagamento;
- 0 settlements sem entrega;
- 0 requotes incompletos.

As funções `SECURITY DEFINER` possuem `search_path` configurado de forma restrita. As 12 Edge Functions ativas exigem JWT.

## Runtime e cron

Na janela analisada de 24 h:

- erros Postgres de aplicação fora de `mgmt-api`: **0**;
- erros observados em `mgmt-api` foram gerados pelas próprias auditorias/migrations transacionais;
- jobs `chama-*`: **2.033 execuções succeeded** no período observado;
- nenhuma execução não-succeeded foi encontrada na consulta;
- retries de reward e settlement são limitados e possuem dead-letter.

## Advisors

Security Advisor:

- `RLS Enabled No Policy` permanece INFO intencional para as tabelas server-only;
- warnings do schema `cron` pertencem ao `pg_cron` gerenciado.

Performance Advisor:

- índices marcados como unused não são removidos enquanto o banco estiver sem tráfego real;
- ausência de uso em banco vazio não prova desperdício.

## Resultado de CI

O branch v1.27 executa:

- syntax;
- integridade SHA-384 do Supabase JS;
- type/secret audit das Edge Functions;
- marketplace simulations;
- static trust/security audit;
- runtime origin config;
- backend security contract;
- runtime migration contract;
- runtime operations contract;
- server-domain simulations;
- mobile smoke;
- Chrome E2E completo;
- manifest.

A regra continua: nenhum merge com gate vermelho. O go-live continua bloqueado até origens dedicadas, Auth/Turnstile, primeira revenda real e E2E multi-dispositivo com dinheiro/entrega reais.


---

# Auditoria v1.28 — First Real Merchant Pilot

## Objetivo

Preparar o TAMÃO para operar com um primeiro parceiro real sem fabricar concorrência, documentação regulatória ou disponibilidade que ainda não existe.

## Staging comercial

O Supabase real agora contém um registro em `pilot_partner_drafts`:

- nome: **Gas e Lenheira do JR**;
- produto inicial: P13;
- preço comercial informado: R$ 115,90 entregue;
- `price_status=proposed`;
- `onboarding_status=awaiting_legal_data`;
- `merchant_id=null`.

A tabela possui RLS, zero acesso para `public/anon/authenticated` e autoridade apenas server-side.

Esse registro deliberadamente **não** cria linha em `merchants`, não exige CNPJ fictício, não recebe ANP fictícia e não entra no matching.

## Prova de isolamento do staging

Após aplicar a migration:

- `pilot_partner_drafts`: 1 registro;
- `merchants`: 0;
- `market_supply_status().realSupplyConfigured=false`;
- `configuredMerchantCount=0`;
- `availableMerchantCount=0`.

Portanto o pré-lançamento continua fail-closed até os dados reais serem cadastrados.

## Mercado com fornecedor único

O ranking agora possui uma regra explícita:

- 0 candidatos → nenhuma oferta;
- 1 candidato → uma única oferta com label `available`;
- 2+ candidatos → marketplace com ranking e até 3 parceiros distintos.

O cliente recebe `marketMode=single_supplier` quando há apenas uma revenda elegível e a UI deixa de prometer comparação inexistente.

## Distribuição quando novas revendas entrarem

A recomendação usa valor ao consumidor como autoridade principal:

- 45% preço;
- 35% ETA;
- 20% trust.

Preço e ETA usam diferenças economicamente significativas em vez de normalização pelo extremo do conjunto. Assim uma diferença de R$ 1 ou 1 minuto entre apenas duas revendas não vira artificialmente “0 versus 1”.

Carga operacional é secundária:

- pedidos ativos: penalidade máxima de 0,055;
- pedidos dos últimos 7 dias: penalidade máxima de 0,025;
- só parceiros dentro de 0,10 do melhor score base podem ganhar a recomendação por menor carga.

Consequência: parceiros novos podem receber oportunidade quando são competitivos, mas uma oferta claramente pior não é promovida apenas para forçar distribuição.

## Sinais de distribuição

`merchant_offer_load(uuid[])` calcula server-side:

- pedidos ativos por merchant;
- pedidos não cancelados nos últimos 7 dias.

A função é `SECURITY DEFINER`, possui `search_path=pg_catalog`, é revogada para `public/anon/authenticated` e concedida somente a `service_role`.

## Interface administrativa

O control plane passa a mostrar “Parceiros piloto em preparação”, separado de:

- aplicações;
- merchants;
- compliance;
- operações ativas.

O registro informa explicitamente que o preço é proposto e que CNPJ, responsável, endereço, owner e validações ainda são gates obrigatórios.

## Gates adicionados

A suíte agora falha se:

- staging criar merchant automaticamente;
- preço proposto nascer confirmado;
- staging for tratado como supply real;
- fornecedor único gerar múltiplas opções fictícias;
- ranking não possuir banda de qualidade;
- carga puder substituir a autoridade principal de preço/ETA/trust;
- migration deixar staging ou `merchant_offer_load` acessível ao browser.

O server-domain possui simulações determinísticas para:

1. um único fornecedor;
2. dois fornecedores próximos, com distribuição pela carga;
3. fornecedor novo claramente pior, que deve continuar fora da recomendação.

## Estado de go-live

A v1.28 prepara o piloto, mas a primeira compra real continua bloqueada até cadastrar e comprovar os dados reais do parceiro e as origens/Auth/Turnstile necessários.

Nenhum dado jurídico ou regulatório foi inferido a partir da relação pessoal com o proprietário.


---

# Auditoria v1.29 — Internal Full Pilot

## Objetivo

Usar o GitHub Pages, ainda sem divulgação e sem domínio próprio, como ambiente de validação operacional completa sem transformar a prévia em comércio real.

## Isolamento

O modo interno é ativado apenas quando:

- hostname = `carloskk07.github.io`;
- path começa por `/gassg/`.

Nesse ambiente:

- `CHAMA_INTERNAL_PILOT=true`;
- o motor de simulação é ativado;
- customer live permanece desligado;
- merchant/admin live continuam proibidos na origem compartilhada;
- nenhuma Edge Function de criação de pedido é usada pelo fluxo simulado.

## Cenário JR

O seed interno possui apenas:

- parceiro: `Gas e Lenheira do JR — SIMULAÇÃO`;
- P13: R$ 115,90;
- entrega: incluída;
- demais parâmetros (estoque, ETA, distância, trust): explicitamente simulados.

Nenhum CNPJ/ANP ou dado jurídico é inventado.

## Fluxo testável

A prévia permite exercitar ponta a ponta:

1. cliente escolhe P13;
2. informa endereço;
3. recebe uma única opção “Disponível agora”;
4. cria pedido local;
5. alterna para painel da revenda;
6. aceita;
7. confirma saída;
8. confirma chegada;
9. cliente visualiza código;
10. revenda confirma pagamento + código;
11. pedido liquida;
12. cashback simulado é creditado.

## Anti-confusão

A UX exibe em múltiplos pontos:

- “PILOTO INTERNO — SEM PEDIDOS REAIS”;
- “Simulação operacional”;
- “Sem validação jurídica nesta tela”;
- nome da revenda com sufixo “SIMULAÇÃO”;
- aviso de que nenhuma ação gera venda, cobrança, entrega ou baixa de estoque real.

## Não divulgação

Enquanto o ambiente for interno:

- meta robots = `noindex,nofollow,noarchive,nosnippet`;
- `robots.txt` bloqueia todo crawling;
- GitHub Pages não recebe customer/merchant/admin origin;
- Turnstile/live auth continuam reservados para a futura origem dedicada.

## Prova automatizada

O Chrome E2E agora executa o fluxo padrão e, em seguida, ativa o cenário JR e prova:

- exatamente 1 merchant simulado;
- ID `JR-PILOT`;
- preço P13 = 115.90;
- uma única oferta;
- role `Disponível agora`;
- ausência do rótulo “Parceiro local verificado” no piloto;
- aceite, despacho, chegada, PIN, pagamento e settlement;
- cashback final de R$ 1,15.

Esse modo pode ser removido ou convertido em staging dedicado quando os domínios/origens reais forem criados.


---

# Auditoria v1.30 — Merchant Conversion

## Objetivo

Revisar o TAMÃO do ponto de vista de um proprietário de revenda que precisa responder quatro perguntas antes de entrar:

1. isso pode trazer pedidos novos?
2. quanto custa?
3. quanto pode sobrar depois dos meus próprios custos?
4. quanto controle e risco operacional eu assumo?

## Problema identificado

A experiência anterior explicava muito bem catálogo, aceite, online/offline e taxa de 7,5%, mas colocava o custo da plataforma antes de demonstrar de forma concreta o valor econômico recebido pelo parceiro.

O simulador anterior mostrava apenas:

`vendas brutas - taxa TAMÃO`.

Esse valor não é lucro e poderia ser interpretado dessa forma por um parceiro menos atento.

## Correções

### Margem incremental

`merchantMarginExample()` agora calcula:

- vendas brutas;
- taxa TAMÃO de 7,5%;
- custo do produto informado;
- custo de entrega informado;
- custo de pagamento informado;
- tributos informados;
- contribuição estimada;
- contribuição unitária;
- margem percentual estimada.

Nenhum custo desconhecido é inventado. O preço de R$ 115,90 do cenário JR aparece como preço de venda do exemplo, enquanto custos próprios começam em zero e são explicitamente solicitados ao parceiro.

### Sem exclusividade

A landing declara que o TAMÃO é um canal adicional. Telefone, WhatsApp, balcão e demais canais próprios continuam fazendo parte da operação.

### Distribuição

O parceiro passa a receber explicação comercial da autoridade `offer-ranking` sem exposição da fórmula interna detalhada:

- preço;
- ETA;
- confiança;
- carga apenas entre opções próximas.

A interface explicita que uma revenda não precisa ser sempre a mais barata e que menor carga não promove uma opção claramente pior.

### Multiproduto

O catálogo deixa de ser apresentado apenas como capacidade técnica e passa a ser explicado como aumento de ticket por deslocamento: GLP, água, lenha, carvão e gelo podem compartilhar a mesma oportunidade comercial quando a logística permitir.

### Dinheiro

A landing ganhou um fluxo de quatro estados:

`Pedido → Pagamento → Conclusão → Conciliação`.

Nenhum prazo de repasse foi inventado. A abertura pública continua bloqueada até validar cobrança, Pix/dinheiro/cartão, cashback, estorno e conciliação ponta a ponta.

### Parceiro Fundador

A proposta de entrada antecipada é apresentada sem prometer volume, preferência algorítmica ou renda. Os benefícios divulgados são participação, onboarding, acesso antecipado e feedback.

### Piloto interno

No host de laboratório, o CTA de aquisição muda para **Experimentar painel da revenda** e abre o painel JR local. O E2E comprova que essa rota não depende do portal live e não cria transação real.

## Gates

A suíte falha se:

- o simulador voltar a chamar receita de lucro;
- custos próprios deixarem de entrar no cálculo;
- a landing remover a mensagem de não exclusividade;
- distribuição deixar de ser explicada;
- multiproduto deixar de ser associado a ticket;
- o fluxo financeiro esconder a condição de repasse ainda não validada;
- Parceiro Fundador virar promessa de pedidos/renda;
- o piloto interno voltar a apontar o CTA principal para um portal real ainda sem origem dedicada.

---

# Auditoria v1.31 — Reliability, Concurrency & Boundary Hardening

## Escopo

Rodada de auditoria pós-v1.30 com foco em falhas de produção que não dependem da jornada feliz:

- segurança server-only residual;
- concorrência e respostas assíncronas obsoletas;
- retries e ACK perdido;
- onboarding de revenda;
- consistência entre estado visual e matching;
- starvation de parceiros;
- limites monetários do PostgreSQL;
- robustez do CI;
- fuzz determinístico de ranking e finanças;
- invariantes do banco real, crons, advisors e logs.

## Achados corrigidos

### 1. Sequência pública antiga ainda utilizável pelo browser

As tabelas e funções públicas já estavam fechadas, mas `order_events_id_seq` ainda conservava `USAGE` para `anon/authenticated`.

Correção:

- `revoke all on all sequences in schema public from anon, authenticated`;
- baseline `schema.sql` atualizado;
- gate de CI impede regressão;
- defaults futuros continuam fechados.

Prova no projeto real depois da correção:

- grants de tabela para browser: **0**;
- funções públicas executáveis por browser: **0**;
- sequências públicas utilizáveis por browser: **0**.

### 2. FK do staging do primeiro parceiro sem índice

`pilot_partner_drafts.merchant_id` foi apontada pelo advisor de performance como FK sem índice de cobertura.

Correção:

- criado `pilot_partner_drafts_merchant_idx`;
- advisor deixa de apontar FK sem cobertura.

Os avisos restantes de performance são apenas `unused_index`, esperados enquanto o banco real ainda não possui tráfego de produção.

### 3. Cadastro rejeitado não podia ser reenviado

A unicidade por `(applicant_user_id, cnpj)` impedia um parceiro rejeitado de corrigir dados e enviar novamente.

Correção:

- registro rejeitado é atualizado e volta a `pending`;
- retry após ACK perdido recupera o mesmo cadastro `pending`;
- cadastro já aprovado retorna conflito sem duplicar operação;
- atualização é condicionada a `status in ('pending','rejected')`, fechando corrida TOCTOU com aprovação administrativa;
- mudança concorrente de estado retorna erro sem reabrir cadastro aprovado.

### 4. Origem errada no onboarding real da revenda

`submit-merchant-application` estava associada à origem do cliente embora o formulário live só exista no portal isolado da revenda.

Correção:

- Edge Function passa a exigir `MERCHANT_ALLOWED_ORIGIN`;
- gate estático impede retorno ao contrato anterior.

### 5. Estado “ONLINE” incompatível com matching

Era possível desativar `accepts_citywide` e manter `online=true`. O parceiro via ONLINE, enquanto `get-offers` o excluía.

Correção:

- desligar atendimento em São Gabriel pausa novos pedidos na mesma operação;
- tentativa de voltar online sem a área ativa é bloqueada;
- UI passa a explicar o bloqueio comercial.

### 6. Retries incompletos em falha ambígua

`create-order` já tinha recuperação especial, mas outras mutações idempotentes podiam terminar no servidor e chegar como timeout/5xx ao navegador.

Correção:

- autoridade compartilhada `retryAmbiguousOnce()`;
- mesma idempotency key reaproveitada em:
  - create-order;
  - customer-action;
  - merchant-action;
  - complete-delivery;
  - ações administrativas;
- escritas de configuração repetíveis da revenda recebem um retry em falha ambígua;
- cadastro de parceiro também sobrevive a ACK perdido sem duplicar candidatura.

### 7. Polling concorrente e resposta velha sobrescrevendo estado novo

O timer global roda a cada 5 s e uma requisição pode durar até 15 s. Sem single-flight, ciclos podiam se sobrepor.

Correção:

- cliente, revenda e admin ganham `pollPending`;
- refresh financeiro/mercado/merchant/admin recebe sequência monotônica;
- resposta obsoleta é descartada;
- polling administrativo completo é limitado a aproximadamente 15 s.

### 8. Starvation de revendas antes do ranking

`get-offers` aplicava `.limit(40)` antes de catálogo, elegibilidade e ranking. Com mais de 40 operações elegíveis, a ordem física do banco poderia impedir parceiros de participar da disputa.

Correção:

- removido o corte arbitrário pré-ranking;
- teste de regressão proíbe `.limit(40)` nessa etapa;
- futura expansão geográfica deve usar filtro de área explícito, não truncamento não determinístico.

### 9. Overflow monetário possível apesar de inputs “válidos”

A API aceitava preço unitário de até 100.000.000 centavos e quantidade de até 99, enquanto `line_total_cents`, `gross_total_cents` e correlatos são `integer` de 32 bits.

Correção:

- preço unitário máximo: **1.000.000 centavos (R$ 10.000)**;
- constraint no catálogo, quote item e order item;
- Edge Function e UI usam o mesmo teto;
- com 20 linhas × 99 unidades × 1.000.000 centavos + taxa máxima de entrega, a cesta extrema suportada fica em **1.980.100.000 centavos**, abaixo de `2.147.483.647`;
- fuzz prova que o teto antigo ultrapassaria `int4`.

### 10. Simulador podia sugerir margem antes dos custos

A v1.30 iniciava custo do produto em zero. Mesmo com aviso textual, a interface podia mostrar uma margem alta antes do parceiro informar o principal custo.

Correção:

- custo do produto começa vazio;
- bruto e taxa continuam calculáveis;
- contribuição, contribuição unitária e margem ficam como `—` até o custo do produto ser informado;
- gate E2E impede regressão.

### 11. CI vulnerável a falha transitória do CDN

Durante a própria auditoria, o download usado para conferir o SHA-384 do Supabase JS falhou com `Recv failure: Connection reset by peer`.

Correção:

- `curl` recebe retry, retry-all-errors, connect timeout e max-time;
- SHA-384 esperado permanece idêntico;
- resiliência de rede sem relaxar integridade.

## Simulações e gates

Além das 35 simulações existentes, a v1.31 adiciona fuzz determinístico:

- **6.000 cenários de ranking**;
- **3.000 cenários de margem**;
- prova explícita do limite `int4`;
- forte dominância não pode ser derrubada por balanceamento de carga;
- cheapest e fastest continuam presentes entre as ofertas escolhidas quando distintos;
- single supplier continua recebendo rótulo `available`.

Audit/CI também prova:

- retry apenas em falha ambígua;
- mesma idempotency key no retry;
- polling single-flight;
- descarte de resposta stale;
- reenvio seguro de aplicação;
- área de atendimento coerente com ONLINE;
- ausência do corte pré-ranking de 40 merchants;
- constraints monetárias nas três tabelas;
- cache PWA `chama-sg-v1.31`.

## Supabase real

Estado observado nesta rodada:

- profiles: **0**;
- merchants reais: **0**;
- pilot partner drafts: **1**;
- orders: **0**;
- quotes: **0**;
- wallet entries: **0**;
- applications: **0**;
- platform admins: **0**.

Invariantes consultadas diretamente retornaram zero para:

- cliente com múltiplos pedidos ativos;
- autoindicação;
- settlement sem pagamento;
- settlement sem entrega;
- entrega/settlement sem dispatch;
- valores negativos;
- cashback acima do bruto;
- `total != gross - cashback`;
- itens/eventos/ledger órfãos;
- draft apontando para merchant inexistente.

Crons nas últimas 24 h:

- **2.043 execuções succeeded**;
- nenhum status de falha encontrado.

Os dois erros PostgreSQL inicialmente encontrados na busca de logs são eventos históricos de `application_name=mgmt-api` durante tentativas antigas de aplicar migration; não são tráfego da aplicação.

Security advisor:

- 33 avisos `RLS Enabled No Policy` são intencionais no data-plane server-only;
- warnings de anonymous policy pertencem às tabelas gerenciadas pelo `pg_cron`, não às tabelas públicas da aplicação.

Performance advisor:

- apenas `unused_index` permanece;
- não remover índices com banco sem tráfego real, pois ausência de uso ainda não é evidência de redundância.

## Estado operacional

A v1.31 reduz bugs de concorrência, rede, onboarding, matching e limites de banco, mas **não libera lançamento público em dinheiro real**.

Ainda precisam de prova operacional antes do go-live:

- três origens HTTPS distintas;
- Supabase Auth/redirect URLs;
- Turnstile;
- primeiro administrador permanente;
- cadastro jurídico/compliance do primeiro parceiro real;
- catálogo/estoque/taxa/ETA reais;
- cobrança/conciliação/repasse;
- E2E multi-dispositivo real até pagamento + PIN + settlement + benefícios.

---

# Auditoria v1.32 — Merchant-Authorized Pricing Range

## Objetivo

Permitir que a revenda autorize uma faixa de preço por SKU sem entregar ao marketplace autoridade ilimitada sobre sua margem.

## Contrato

Cada SKU possui:

- modo fixo ou faixa automática;
- preço mínimo;
- preço normal;
- preço máximo;
- estratégia volume/equilibrado/margem;
- confirmação independente de freshness.

O banco impõe:

`min <= normal <= max`

e, no modo fixo:

`min = normal = max`.

## Autoridade automática

`pricing-policy.js` usa somente:

- estoque próprio;
- quantidade pedida;
- pedidos ativos próprios;
- volume recente próprio;
- estratégia escolhida pelo parceiro.

Nenhum preço concorrente é entrada da função.

Depois disso, o ranking compara as ofertas finais normalmente.

## Segurança da cotação

A primeira implementação da v1.32 foi deliberadamente auditada contra migrations históricas. Foi encontrada e corrigida uma regressão em que a adaptação inicial do RPC havia partido de uma definição antiga de `create_quote_snapshot`.

O follow-up restaura explicitamente:

- `delivery_fee_confirmed_at`;
- `catalog_items.price_confirmed_at` por SKU;
- lock `FOR SHARE` dos SKUs;
- stock sob lock;
- validação do preço efetivo dentro da faixa;
- teto int4;
- snapshot do preço realmente ofertado.

Novo gate impede que uma futura migration perca essas autoridades.

## Simulações

A suíte cobre:

- preço fixo invariável;
- 5.000 combinações aleatórias de faixa automática;
- mínimo/máximo nunca violados;
- volume <= equilibrado <= margem em condições iguais;
- maior pressão operacional nunca reduz preço;
- 6.000 cenários de ranking já existentes;
- 3.000 cenários de margem já existentes;
- E2E do piloto JR ativando uma faixa simulada e obtendo oferta no piso autorizado.

## Piloto JR

O registro comercial real continua P13 = **R$ 115,90 entregue** e não recebe faixa real por inferência.

No laboratório interno, JR começa em preço fixo. O E2E altera explicitamente para uma faixa simulada de R$ 115,90 / R$ 120,00 / R$ 125,00 apenas para provar a UX e a autoridade técnica.

---

# Auditoria v1.33 — JR Confirmed Commercial Range

## Informação comercial confirmada

O parceiro piloto **Gas e Lenheira do JR** confirmou para P13, com entrega incluída:

- mínimo autorizado: **R$ 115,90**;
- preço normal: **R$ 120,00**;
- máximo autorizado: **R$ 125,00**.

O staging foi promovido de `price_status=proposed` para `price_status=confirmed` e passou a usar `pricing_mode=range` com estratégia inicial `balanced`.

## Isolamento preservado

Essa confirmação comercial não remove nenhum gate de ativação:

- `onboarding_status=awaiting_legal_data`;
- `merchant_id=null`;
- 0 merchants reais;
- o draft não participa de `market_supply_status()`;
- o draft não participa de matching;
- o draft não pode receber pedido real.

## Banco

`pilot_partner_drafts` agora possui autoridade explícita de faixa:

- `pricing_mode`;
- `min_delivered_price_cents`;
- `preferred_delivered_price_cents`;
- `max_delivered_price_cents`;
- `pricing_strategy`.

Constraints impõem:

`min <= normal <= max`

e, quando `pricing_mode=fixed`:

`min = normal = max`.

## Laboratório interno

O cenário JR agora nasce com o preço normal de **R$ 120,00** e a faixa confirmada **R$ 115,90–R$ 125,00**. A estratégia inicial é equilibrada.

O preço calculado no laboratório permanece dentro da faixa. Alterar estratégia, estoque ou carga na simulação não modifica a condição comercial real cadastrada no staging.



## V1.48 — Rebrand TAMÃO

A camada pública foi migrada de Chama para **TAMÃO** sem renomear contratos internos que sustentam autenticação, storage, crons, Edge Functions e configuração de origens. Essa separação reduz risco de regressão durante o rebrand. A prova desta versão exige metadata/PWA TAMÃO, shell com o novo símbolo, hero **“Pediu? Tá na mão.”**, Proteção TAMÃO, Clube TAMÃO, portais live com metadata atualizada e smoke/E2E alinhados à nova marca.


## V1.49 — Acquisition readiness

### Objetivo

Transformar o pré-lançamento do TAMÃO em um funil real de aquisição para **clientes** e **parceiros**, preservando o bloqueio do comércio até os gates operacionais passarem.

### Cliente

A home passa a oferecer **Quero ser avisado** quando ainda não existe supply real disponível. O cadastro coleta somente dados úteis ao pré-lançamento: nome opcional, WhatsApp, CEP, categorias de interesse e consentimento explícito.

O CEP serve também como sinal de demanda para priorizar recrutamento de parceiros por região. Nenhum pedido, cobrança ou reserva de estoque é criado pelo cadastro.

### Parceiro

A landing de revendas passa a separar **interesse comercial** de **onboarding operacional**. O primeiro contato pede nome da empresa, responsável, WhatsApp, categorias e CEP opcional. CNPJ e validações regulatórias continuam no onboarding formal posterior.

### Atribuição

O endpoint conserva UTMs, referrer e landing path. Isso permite medir anúncios sem depender inicialmente de pixels de terceiros.

### Segurança e privacidade

- tabela `prelaunch_leads` é server-only;
- browser `anon/authenticated` não possui SELECT/INSERT/UPDATE/DELETE;
- Edge Function aceita apenas origens explícitas;
- payload limitado e validado;
- honeypot;
- consentimento obrigatório;
- deduplicação por tipo + WhatsApp;
- rate limit por hash de IP;
- IP bruto não é armazenado.

### Operação

O admin protegido recebe até os leads mais recentes com tipo, interesse, CEP, origem de campanha e atalho para WhatsApp. A captação não altera `platform_launch_control` nem habilita comércio real.

### Gate de publicação

GitHub Pages permanece laboratório interno e `noindex` até o domínio TAMÃO e a arquitetura de origem pública serem comprovados. A troca de SEO/indexação só pode acontecer depois dessa verificação.


## V1.50 — Trust & launch authority

### Superfície pública

O TAMÃO passa a ter três rotas públicas persistentes: **Privacidade**, **Termos** e **Contato**. O footer as mantém acessíveis em todas as jornadas públicas.

### Direitos e contato

O formulário oficial suporta dúvidas gerais, suporte e solicitações de privacidade. Pedidos de privacidade podem ser categorizados como confirmação, acesso, correção, eliminação, informações, revogação ou outro assunto.

A submissão é server-only, possui protocolo curto de retorno e pode exigir confirmação de identidade antes de qualquer entrega/alteração de dados.

### Segurança do canal

- tabela `public_requests` sem acesso de `anon/authenticated`;
- Edge Function pública com allowlist de origem;
- payload máximo;
- honeypot;
- acknowledgement explícito;
- contato validado;
- rate limit server-side reutilizando a autoridade antiabuso existente;
- IP bruto não é persistido;
- admin protegido recebe as solicitações.

### Build público

`scripts/build-public-site.mjs` cria um artefato por allowlist. Somente index, manifest, service worker, robots, CSS, JS e ícones entram na publicação. Diretórios internos permanecem fora.

O GitHub Pages e o futuro Cloudflare Pages devem usar a mesma autoridade de build.

### Indexação

O laboratório permanece `noindex` e `robots.txt: Disallow: /` até a prova de domínio/HTTPS. O `robots.txt` agora é copiado para o artefato de Pages, corrigindo a divergência anterior entre repositório e publicação.


## V1.51 — Launch operations authority

### Problema fechado

Captação sem workflow produz lista de contatos, não operação. A V1.51 transforma leads e solicitações públicas em filas administráveis e auditáveis.

### Pipeline comercial

`prelaunch_leads` ganha nota interna e timestamps de contato, qualificação, conversão e encerramento. Estados finais não podem ser reabertos pelo endpoint administrativo.

### Fila de confiança

`public_requests` passa a ter transições administrativas explícitas. Resolver ou encerrar exige nota de resolução.

### Segurança

As duas autoridades novas:

- validam `platform_admins`;
- possuem idempotência via `action_requests`;
- travam a linha com `FOR UPDATE`;
- validam transição;
- escrevem auditoria;
- não concedem EXECUTE a `anon` nem `authenticated`;
- concedem EXECUTE apenas a `service_role`.

### Conversão operacional

O admin exibe estágios e oferece ações explícitas. Abrir WhatsApp/e-mail não altera status automaticamente; o operador precisa confirmar a mudança de etapa, evitando falsos positivos.


## V1.52 — Cloudflare production build authority

A publicação passa a possuir modos explícitos em vez de depender de edição manual no dia do lançamento.

- `lab`: build padrão usado pelo GitHub Pages interno;
- `cloudflare + noindex`: domínio oficial em pré-lançamento, com captação ativa e crawling bloqueado;
- `cloudflare + indexável`: meta robots, robots.txt e sitemap coerentes;
- `cloudflare + live-runtime`: exige origins HTTPS isoladas, origem do cliente igual ao domínio público e Turnstile real.

O Cloudflare build gera `_headers` com CSP por resposta, proteção contra framing, `nosniff`, Referrer-Policy, Permissions-Policy e cache fail-safe para HTML, service worker e runtime config.

O CI constrói e valida os modos de pré-lançamento e indexável e prova que runtime real sem configuração obrigatória falha.


## V1.53 — Prelaunch conversion UX

A auditoria de conversão encontrou dois atritos de pré-lançamento: o switcher de revenda podia tentar abrir um portal ainda sem origem configurada e a navegação mobile mantinha ações de pós-compra antes de existirem pedidos reais.

A V1.53 corrige ambos de forma contextual. Durante o pré-lançamento público, os caminhos principais são **lista de abertura, entendimento, parceria e contato**. Quando a operação real estiver disponível, a navegação operacional volta automaticamente.

A home também passa a declarar a situação atual sem métricas inventadas: São Gabriel como praça inicial, primeiro parceiro piloto ainda em preparação e cadastro sem pedido/cobrança.


## V1.54 — Follow-up operations

A captação já possuía pipeline, mas o primeiro contato ainda começava numa conversa vazia. A V1.54 adiciona mensagens iniciais contextualizadas para clientes, parceiros e solicitações públicas e prioriza a fila por estágio/idade.

O link do WhatsApp de uma solicitação pública leva apenas um texto operacional com protocolo e tipo de atendimento; o conteúdo original enviado pelo usuário não é copiado para o parâmetro da URL.

A abertura da conversa não marca o lead como contatado. O estado continua dependente de uma ação explícita do administrador, preservando a qualidade da métrica de conversão.


## V1.55 — Acquisition intelligence

### Problema fechado

O resumo administrativo carregava no máximo 200 leads. Usar essa amostra para medir campanha produziria taxas incorretas assim que a aquisição ultrapassasse esse volume.

### Solução

A função `admin_prelaunch_acquisition_metrics` agrega a base inteira dentro do Postgres e retorna somente estatísticas, sem transportar PII adicional ao navegador.

O funil usa os timestamps históricos (`contacted_at`, `qualified_at`, `converted_at`) em vez de inferir avanço apenas pelo status atual. Isso mantém as taxas corretas mesmo quando um lead já chegou a convertido.

### Segurança

- `SECURITY DEFINER` com search path restrito;
- relações referenciadas com schema explícito;
- `require_platform_admin`;
- EXECUTE revogado de PUBLIC, anon e authenticated;
- EXECUTE concedido somente ao service_role;
- Edge Function já autentica o usuário e exige admin antes de solicitar o agregado.

### Escala

A lista visual permanece limitada aos 200 leads mais recentes para operação. Métricas e campanhas usam todos os registros, eliminando o viés da janela recente.


## V1.56 — First-party prelaunch analytics

### Objetivo

Criar o denominador que faltava entre anúncio e lead sem instalar Meta Pixel, Google Analytics ou identificadores persistentes de terceiros.

### Minimização

O navegador envia somente:

- tipo de evento;
- público cliente/parceiro;
- source / medium / campaign / content;
- pathname + rota;
- hostname do referenciador.

Não envia query completa de navegação, UTM term, nome, telefone, CEP ou identificador analítico persistente.

### Antiabuso

O endpoint público possui allowlist de origem, payload cap e rate limit server-side. O IP pode ser processado para produzir o hash técnico usado na quota, mas não é gravado na tabela de analytics.

### Persistência

`prelaunch_marketing_event_daily` guarda apenas contadores diários agregados. RLS está ativo e browser roles não possuem privilégios.

`record_prelaunch_marketing_event` usa SECURITY INVOKER e só pode ser executada por `service_role`.

### Escopo de produção

O cliente só ativa a medição no domínio oficial e enquanto `prelaunchExamplesEnabled()` indicar pré-lançamento. CI, localhost, GitHub Pages e previews ficam fora.

### Prova atômica

O incremento foi testado duas vezes dentro de uma transação e comprovado como contador 2; a transação foi revertida e deixou zero linhas de teste no banco.


## V1.57 — First-admin bootstrap diagnostics

### Falha anterior

O endpoint de claim registrava erros no log, mas devolvia `{ok:true}` mesmo quando a autoridade SQL falhava. O navegador então consultava o admin, recebia 403 e apresentava a mesma tela de "conta não autorizada" para situações distintas.

Isso não elevava privilégio, porém dificultava distinguir:

- e-mail autenticado incorreto;
- bootstrap já encerrado;
- erro temporário de concorrência;
- falha real do backend.

### Correção

`admin-auth` passou a expor somente quatro estados permitidos: `claimed`, `existing_admin`, `not_reserved` e `bootstrap_closed`.

Erros SQL são mapeados para respostas fechadas:

- `40001` → `ADMIN_BOOTSTRAP_RETRY` / HTTP 409;
- identidade não confirmada → HTTP 403;
- demais falhas → `ADMIN_BOOTSTRAP_FAILED` / HTTP 503.

Nenhum payload interno do RPC é devolvido.

### Runtime

O painel possui estados separados para:

- acesso negado conclusivo;
- falha de validação;
- bootstrap reivindicado;
- admin já existente.

A opção "Validar acesso novamente" repete apenas a autoridade server-side. O browser continua incapaz de criar linha em `platform_admins`.

### Situação observada durante a auditoria

- 0 administradores ativos;
- 1 reserva ainda não reivindicada;
- 0 usuários permanentes confirmados correspondendo à reserva;
- cron de bootstrap ativo.

Logo, o próximo passo operacional ainda é autenticar a conta reservada pelo magic link no portal administrativo dedicado.
