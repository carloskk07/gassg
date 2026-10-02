# Auditoria v1.23 — Chama São Gabriel

Data: 01/10/2026

## Status

**READY_FOR_PROTECTED_ONLINE_PILOT**

A arquitetura multiusuário, o banco, as Edge Functions, os jobs e os gates de release estão implantados. O GitHub Pages continua sendo somente a prévia de pré-lançamento e falha fechado para transações reais.

**NOT_YET_APPROVED_FOR_PUBLIC_REAL-MONEY LAUNCH**

O bloqueio restante é operacional, não uma falha arquitetural já conhecida: ainda não existem administrador permanente, revenda real, usuário real, pedido real nem um E2E multi-dispositivo de produção. Cliente, revenda e admin também precisam das três origens HTTPS dedicadas e da configuração externa de Auth/Turnstile antes do go-live.

Na verificação desta rodada, o banco de produção permanecia com **0 usuários, 0 pedidos, 0 revendas, 0 memberships, 0 aplicações e 0 administradores reais**.

## Release auditado

- SHA funcional da v1.23: `2f9dec02b73f04d674554679d82114249df7221a`;
- PR #12 integrada por squash;
- workflow **Audit** executado também no SHA final de `main` e aprovado;
- workflow **Deploy to GitHub Pages** aprovado no mesmo SHA;
- `get-offers` publicado no Supabase como **v11**, ACTIVE, com `verify_jwt=true`;
- migration `generalized_product_code_contract` aplicada em produção.

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

## Achados eliminados nesta rodada

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

Estado pós-v1.22:

- 32 tabelas públicas da aplicação com RLS ativo;
- 0 policies nessas tabelas de data-plane;
- 0 grants diretos para `anon`, `authenticated` ou `public`;
- 0 funções públicas da aplicação executáveis por browser;
- funções `SECURITY DEFINER` protegidas e com `search_path` restrito;
- todas as 12 Edge Functions ativas exigem JWT;
- os 12 entrypoints publicados correspondem aos entrypoints do `main`;
- nenhum `service_role`/secret é exposto no frontend.

Os 32 avisos `RLS Enabled No Policy` do Security Advisor continuam sendo **INFO intencional**: o browser não possui grants e a arquitetura é server-only. Os dois warnings do schema `cron` são do `pg_cron` gerenciado.

## Logs pós-deploy

Na janela imediatamente posterior à migration/deploy:

- Postgres/PostgREST/PgBouncer operaram normalmente;
- não foram encontrados eventos contendo error/failed/exception/panic;
- o projeto permaneceu ACTIVE_HEALTHY.

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
