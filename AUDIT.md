# Auditoria v1.25 — Chama São Gabriel

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
