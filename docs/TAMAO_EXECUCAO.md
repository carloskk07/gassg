# TAMÃO — Diário Oficial de Execução Técnica

**Iniciativa:** TAMÃO — Expansão Integrada e Consolidação para Produção  
**Última atualização:** 2026-10-18  
**Repositório:** `carloskk07/gassg`  
**Branch de integração:** `feat/unified-discovery-tamao`  
**Branch oficial:** `main`  
**Commit-base de `main`:** `433101839489f7739f44ddcf04e664ddff3435bd`  
**SHA do código com Auditoria completa aprovada:** `0658e7b66d1e3d129005edd08ddb01e9de528349`
**Último commit de escopo anterior:** `f34a4ae206c8ec737796212f4b8cd08377e93fff`
**PR principal:** [#492](https://github.com/carloskk07/gassg/pull/492), aberta em rascunho.  
**Escopo:** [TAMAO_ESCOPO.md](TAMAO_ESCOPO.md).  
**Arquitetura:** [TAMAO-EXPANSAO-INTEGRADA.md](TAMAO-EXPANSAO-INTEGRADA.md).

> Este diário é a autoridade persistente sobre andamento. Para saber o SHA exato que contém sua última edição, consultar o histórico do arquivo no GitHub; um documento não pode registrar de forma autorreferente seu próprio hash de commit. Antes de cada continuação, comparar esta anotação com branch, PR, CI, banco e manifests reais.

## Estado real recuperado em 18/10/2026

- Repositório `main` conferido na SHA acima; branch de expansão existente, não criar outra.
- PR #492 aberta como rascunho; consultar lista atual de arquivos na PR.
- CI na SHA `0658e7b`: [Audit PASS](https://github.com/carloskk07/gassg/actions/runs/39148187531), [PostgreSQL 17 PASS](https://github.com/carloskk07/gassg/actions/runs/39148187685), [build dos portais PASS](https://github.com/carloskk07/gassg/actions/runs/39148187501) e [smoke visual PASS](https://github.com/carloskk07/gassg/actions/runs/39148187704). Conferir novamente CI da SHA atual antes de qualquer merge.
- Supabase consultado em leitura: 154 tabelas públicas e 422 funções públicas; `discovery_listings` ainda não existe no banco ativo. Não aplicar migration em produção antes do release gate.
- Estado de `platform_launch_control`: `PRELAUNCH`, `commerce_enabled=false`; 3 portais com último source SHA atestado `433101839489` em 18/10 às 15:06 UTC. O atestado do banco não substitui checagem HTTP recente.
- Apenas 1 revenda estava cadastrada, 0 pedidos (inspeção anterior). Estes totais são históricos e devem ser reconfirmados antes de usá-los comercialmente.
- Nenhum pagamento, publicação de anúncio, abertura de cidade, ativação comercial ou deploy foi executado para a expansão nesta sessão.

## Inventário de tarefas

| ID | Estado | Evidência / lacuna |
|---|---|---|
| CONT-001 | CONCLUÍDA NESTA ETAPA | Diário de execução e escopo persistidos na PR #492 |
| AUD-001 | PARCIAL | Código, CI e banco inspecionados; auditoria profunda de performance, duplicações, armazenamento e UX pendente |
| CORE-001 | PARCIAL | Migration, RLS, RPC e busca pública no código; migration não aplicada, cadastro e mídia ausentes |
| PRO-001 | PARCIAL | Busca pública por UF/cidade e contato WhatsApp na branch; sem cadastro/aprovação comercial |
| RIDE-001 | PARCIAL | Pesquisa por origem/destino, vagas e contato na branch; faltam anúncios, passageiros e moderação |
| STAY-001 | PARCIAL | Busca por cidade, UF e hóspedes na branch; faltam fotos, cadastro, datas, SEO e disponibilidade |
| UI-001 | PARCIAL | Cards na home, rotas de browse e CSS lazy; área de anunciante/admin ainda ausente |
| SEO-001 | NÃO INICIADA | Sem espanhol argentino indexável por destinos |
| ADS-001 | NÃO INICIADA | Integrar com Ads existente, sem duplicar cobranças |
| FIN-001 | NÃO INICIADA | Tabelas sem cobrança; faltam consentimento, tarifas, conciliação e testes |
| REP-001 | NÃO INICIADA | Avaliações autênticas, denúncias e antifraude ausentes |
| ADMIN-001 | NÃO INICIADA | Revisão/ativação das novas modalidades não aparece no painel existente |
| QA-001 | PARCIAL | Audit, PostgreSQL isolado, builds e smoke visual aprovados na SHA 0658e7b; E2E autenticado pendente |
| REL-001 | BLOQUEADA | Fluxos integrais, migrações, SEO, finanças, revisão e publicação ainda pendentes |

## Código e migrações

- `supabase/migrations/20261018131000_discovery_shared_verticals.sql` — **criada na branch; não aplicada** ao banco ativo.
- `tests/discovery-db-integration.sql` — teste isolado de RLS, publicação, pausa, busca, privacidade, cidades.
- `tests/discovery-shared-verticals.mjs` — testes estáticos de autoridade e fronteiras.
- `.github/workflows/discovery-schema-test.yml` — PostgreSQL 17 descartável.
- `.github/workflows/audit.yml` — contrato estático incluído.
- `js/discovery.js`, `css/discovery.css`: buscas e estilos carregados sob demanda.
- `js/bootstrap.js`, `js/customer.js`, `scripts/build-live-portals.mjs`: rotas públicas, entradas da home e isolamento dos pacotes.
- `tests/discovery-public-journeys.mjs`: contratos de busca, filtros, HTML e assets.
- `docs/TAMAO-EXPANSAO-INTEGRADA.md` e `docs/TAMAO_ESCOPO.md` — arquitetura e escopo.
- **Edge Functions modificadas:** nenhuma nesta iniciativa.
- **Banco de produção modificado:** não.
- **Deploys/ativação de modalidades:** nenhum.

## Defeitos, correções e riscos

- Na implementação inicial, teste isolado encontrou erro de delimitador SQL e dependência indevida de leitura de UUID de anunciante; corrigidos e aprovados no PostgreSQL 17 isolado.
- Risco P1 de escopo: não há formulários funcionais, fluxo de anexos, revisão administrativa nem contratação; impedir merge/publicação antecipados.
- Risco P1 a investigar: integridade de imagem, propriedade/visibilidade e validação documental por modalidade no backend.
- Não extrapolar teste de RLS isolado para homologação real em Supabase com Storage/Auth e rede.
- Não reclassificar ausência de jornadas essenciais como entrega concluída.

## Checkpoint operacional obrigatório

**ÚLTIMA ETAPA CONCLUÍDA:** Protocolo persistente implementado e três páginas públicas de descoberta adicionadas à PR #492 com consultas reais e carregamento sob demanda. Build e testes passaram na SHA `0658e7b`.

**ETAPA ATUAL:** Acompanhar o CI do HEAD atual e iniciar fluxo autenticado de anunciantes, fotos e moderação sem aplicar migração em produção.

**PRÓXIMA AÇÃO EXATA:** Ler este checkpoint e o escopo; conferir SHA da PR, workflows e banco; depois implementar criação/edição real de anúncios com upload controlado e envio a revisão do superadmin, adicionando testes de RLS/Storage, vazamento de dados e regressão dos três portais.

**ARQUIVOS QUE DEVEM SER INSPECIONADOS:** `supabase/migrations/20261018131000_discovery_shared_verticals.sql`, `js/discovery.js`, `js/bootstrap.js`, `js/customer.js`, `scripts/build-live-portals.mjs`, `tests/discovery-public-journeys.mjs`, `tests/discovery-db-integration.sql`, `docs/TAMAO_ESCOPO.md`.

**TESTES QUE DEVEM SER EXECUTADOS:** `node tests/discovery-public-journeys.mjs`, `node tests/discovery-shared-verticals.mjs`, `node tests/portal-performance-budget.mjs`, workflows `Audit`, `Build isolated live portals`, `TAMÃO discovery PostgreSQL contract` e `TAMÃO public visual smoke`.

**BLOQUEIOS CONHECIDOS:** Novos anúncios não existem em produção; ainda faltam onboarding autenticado, fotos, moderação, Cobrança Impulso, reputação, SEO argentino, integração e E2E completo. Verificação HTTP direta dos três manifests não foi possível nesta sessão, embora haja atestado de SHA no banco.

**CONDIÇÃO DE CONCLUSÃO:** Para cada vertical, cadastro, autorização, publicação, busca, contato e operação testados; para release, zero P0/P1 conhecidos, recuperação comprovada, migrações e portais reconciliados por SHA e autorização comercial do superadmin.

## Como retomar após interrupção

1. Ler este arquivo e o escopo, sem confiar somente em memória.
2. Comparar PR #492 com o estado atual da `main`, obter SHA da branch.
3. Conferir workflow `Audit` e testes PostgreSQL na SHA atual.
4. Consultar migrações, controles e funções existentes no Supabase **sem repetir aplicações**.
5. Executar a próxima ação exata, registrar defeito e teste de regressão, atualizar este checkpoint.
6. Não criar nova branch/PR para mesma expansão ou liberar anúncio incompleto.
