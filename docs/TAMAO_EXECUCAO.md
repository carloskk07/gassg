# TAMÃO — Diário Oficial de Execução Técnica

**Iniciativa:** TAMÃO — Expansão Integrada e Consolidação para Produção  
**Última atualização:** 2026-10-18  
**Repositório:** `carloskk07/gassg`  
**Branch de integração:** `feat/unified-discovery-tamao`  
**Branch oficial:** `main`  
**Commit-base de `main`:** `433101839489f7739f44ddcf04e664ddff3435bd`  
**SHA do código auditado antes do checkpoint:** `6f5742deaefe3a54c9b35f1111d4f3f53d68bc59`  
**Último commit documental anterior:** `075c86a4758c835023404e9106c7d32295e4af6e`  
**PR principal:** [#492](https://github.com/carloskk07/gassg/pull/492), aberta em rascunho.  
**Escopo:** [TAMAO_ESCOPO.md](TAMAO_ESCOPO.md).  
**Arquitetura:** [TAMAO-EXPANSAO-INTEGRADA.md](TAMAO-EXPANSAO-INTEGRADA.md).

> Este diário é a autoridade persistente sobre andamento. Para saber o SHA exato que contém sua última edição, consultar o histórico do arquivo no GitHub; um documento não pode registrar de forma autorreferente seu próprio hash de commit. Antes de cada continuação, comparar esta anotação com branch, PR, CI, banco e manifests reais.

## Estado real recuperado em 18/10/2026

- Repositório `main` conferido na SHA acima; branch de expansão existente, não criar outra.
- PR #492 aberta, `draft=true`, com 6 arquivos modificados antes do protocolo de continuidade.
- CI da SHA `6f5742d`: [Audit PASS](https://github.com/carloskk07/gassg/actions/runs/39145805790) e [PostgreSQL 17 isolado PASS](https://github.com/carloskk07/gassg/actions/runs/39145805773).
- Supabase consultado em leitura: 154 tabelas públicas e 422 funções públicas; `discovery_listings` ainda não existe no banco ativo. Não aplicar migration em produção antes do release gate.
- Estado de `platform_launch_control`: `PRELAUNCH`, `commerce_enabled=false`; 3 portais com último source SHA atestado `433101839489` em 18/10 às 15:06 UTC. O atestado do banco não substitui checagem HTTP recente.
- Apenas 1 revenda estava cadastrada, 0 pedidos (inspeção anterior). Estes totais são históricos e devem ser reconfirmados antes de usá-los comercialmente.
- Nenhum pagamento, publicação de anúncio, abertura de cidade, ativação comercial ou deploy foi executado para a expansão nesta sessão.

## Inventário de tarefas

| ID | Estado | Evidência / lacuna |
|---|---|---|
| CONT-001 | EM ANDAMENTO | Novo protocolo de checkpoint; validar e registrar a primeira atualização no GitHub |
| AUD-001 | PARCIAL | Repositório, CI, portais e banco inspecionados; falta auditoria profunda de UX, desempenho, armazenamento, segurança e duplicações |
| CORE-001 | PARCIAL | Migration de anúncios e pesquisa; testes PostgreSQL isolados PASS; não aplicada; sem mídia nem frontend funcional |
| PRO-001 | NÃO INICIADA | Cadastro, perfis, buscas, contatos e aprovação completa ainda ausentes |
| RIDE-001 | NÃO INICIADA | Estrutura SQL parcial no CORE; falta jornada de anúncio/consulta e demanda de passageiro |
| STAY-001 | NÃO INICIADA | Estrutura SQL parcial no CORE; falta jornada de hospedagens |
| UI-001 | NÃO INICIADA | Sem navegação completa das novas modalidades |
| SEO-001 | NÃO INICIADA | Sem URLs espanholas/português específicas por destino |
| ADS-001 | NÃO INICIADA | Publicidade existente deve ser integrada, sem mecanismo paralelo |
| FIN-001 | NÃO INICIADA | Schema de tarifa/ledger é base inativa; não há contrato, checkout ou conciliação |
| REP-001 | NÃO INICIADA | Avaliações verificáveis, denúncias e moderação de reputação ausentes |
| ADMIN-001 | NÃO INICIADA | Sem painel de revisão/ativação das novas modalidades |
| QA-001 | PARCIAL | Dois workflows passaram para CORE; falta E2E, concorrência, SEO, pagamentos, recuperação |
| REL-001 | BLOQUEADA | Faltam fluxos completos, validação legal, CI total, revisão e evidência de publicação |

## Código e migrações

- `supabase/migrations/20261018131000_discovery_shared_verticals.sql` — **criada na branch; não aplicada** ao banco ativo.
- `tests/discovery-db-integration.sql` — teste isolado de RLS, publicação, pausa, busca, privacidade, cidades.
- `tests/discovery-shared-verticals.mjs` — testes estáticos de autoridade e fronteiras.
- `.github/workflows/discovery-schema-test.yml` — PostgreSQL 17 descartável.
- `.github/workflows/audit.yml` — contrato estático incluído.
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

**ÚLTIMA ETAPA CONCLUÍDA:** Auditoria pontual e recuperação da PR #492; CI existente e banco verificados. Arquivo de escopo persistente criado.

**ETAPA ATUAL:** Implantar o protocolo de continuidade e validar este checkpoint dentro da branch existente.

**PRÓXIMA AÇÃO EXATA:** Ler `docs/TAMAO_EXECUCAO.md` e `docs/TAMAO_ESCOPO.md` na PR #492; verificar SHA atual, CI e banco. Em seguida implementar o primeiro fluxo real e seguro de cadastro/consulta de anúncios usando a mesma migração e identidade existentes, acrescentando testes de integração e UI antes do merge.

**ARQUIVOS QUE DEVEM SER INSPECIONADOS:** `supabase/migrations/20261018131000_discovery_shared_verticals.sql`, `tests/discovery-db-integration.sql`, `tests/discovery-shared-verticals.mjs`, `js/bootstrap.js`, `js/backend.js`, `js/core.js`, `scripts/build-live-portals.mjs`, `docs/TAMAO-EXPANSAO-INTEGRADA.md`.

**TESTES QUE DEVEM SER EXECUTADOS:** `node tests/discovery-shared-verticals.mjs`; workflow `Audit`; workflow `TAMÃO discovery PostgreSQL contract` (PostgreSQL descartável); builds isolados dos três portais e regressões das jornadas existentes depois de alterações de UI.

**BLOQUEIOS CONHECIDOS:** Novas jornadas sem UI/Edge integrada; SQL não aplicado; sem provedores e condições de cobrança; sem publicação de novas modalidades; SEO argentino não implementado; E2E visual e financeiro pendentes. Nenhum destes itens foi marcado como aprovado.

**CONDIÇÃO DE CONCLUSÃO:** Para cada tarefa, evidência de código, testes e execução funcional real. Para release: zero P0/P1 conhecidos dos recursos liberados, migrações reconciliadas, três manifests oficiais convergentes, recuperação verificada e autorização explícita do superadmin por modalidade/cidade.

## Como retomar após interrupção

1. Ler este arquivo e o escopo, sem confiar somente em memória.
2. Comparar PR #492 com o estado atual da `main`, obter SHA da branch.
3. Conferir workflow `Audit` e testes PostgreSQL na SHA atual.
4. Consultar migrações, controles e funções existentes no Supabase **sem repetir aplicações**.
5. Executar a próxima ação exata, registrar defeito e teste de regressão, atualizar este checkpoint.
6. Não criar nova branch/PR para mesma expansão ou liberar anúncio incompleto.
