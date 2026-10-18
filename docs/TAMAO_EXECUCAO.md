# TAMÃO — Diário Oficial de Execução Técnica

**Iniciativa:** TAMÃO — Expansão Integrada e Consolidação para Produção  
**Última atualização:** 2026-10-18  
**Repositório:** `carloskk07/gassg`  
**Branch de integração:** `feat/unified-discovery-tamao`  
**Branch oficial:** `main`  
**Commit-base de `main`:** `433101839489f7739f44ddcf04e664ddff3435bd`  
**SHA do código e checkpoint com auditoria completa aprovada:** `0d5e7a9bed28771761b584df3442e1437c8719bf`
**Último commit de escopo anterior:** `f34a4ae206c8ec737796212f4b8cd08377e93fff`
**PR principal:** [#492](https://github.com/carloskk07/gassg/pull/492), aberta em rascunho.  
**Escopo:** [TAMAO_ESCOPO.md](TAMAO_ESCOPO.md).  
**Arquitetura:** [TAMAO-EXPANSAO-INTEGRADA.md](TAMAO-EXPANSAO-INTEGRADA.md).

> Este diário é a autoridade persistente sobre andamento. Para saber o SHA exato que contém sua última edição, consultar o histórico do arquivo no GitHub; um documento não pode registrar de forma autorreferente seu próprio hash de commit. Antes de cada continuação, comparar esta anotação com branch, PR, CI, banco e manifests reais.

## Estado real recuperado em 18/10/2026

- Repositório `main` conferido na SHA acima; branch de expansão existente, não criar outra.
- PR #492 aberta como rascunho; consultar lista atual de arquivos na PR.
- CI na SHA `0d5e7a9`: [Audit PASS](https://github.com/carloskk07/gassg/actions/runs/39148608605), [PostgreSQL 17 isolado PASS](https://github.com/carloskk07/gassg/actions/runs/39148608609), [build de três portais PASS](https://github.com/carloskk07/gassg/actions/runs/39148608661) e [smoke visual público PASS](https://github.com/carloskk07/gassg/actions/runs/39148608606). O PR posterior com este texto requer nova CI por SHA.
- Supabase consultado em leitura: 154 tabelas públicas e 422 funções públicas; `discovery_listings` ainda não existe no banco ativo. Não aplicar migration em produção antes do release gate.
- Consulta adicional confirmou **154/154 tabelas com RLS habilitada** e nenhuma função SECURITY DEFINER no schema público executável por `PUBLIC`; isso é uma verificação pontual e não comprova segurança funcional integral.
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
| QA-001 | PARCIAL | Audit, PostgreSQL isolado, builds e smoke visual aprovados na SHA 0d5e7a9; E2E autenticado pendente |
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
- `tests/tamao-execution-checkpoint.mjs`: valida existência e estrutura do diário/escopo; incorporado à auditoria oficial.
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

## Continuação verificada — 18/10/2026, proteção de imagens (CORE-001 / QA-001)

- **Ponto exato de retomada:** PR #492, `feat/unified-discovery-tamao`; `main` permanece em `433101839489`. O HEAD `2d31f63c6ea22a9985b590bc2820172777300a0f` tinha Audit, PostgreSQL 17, builds e smoke visual **PASS**.
- **Supabase real (leitura):** projeto `lgugwujpunhslavewffd` saudável; `to_regclass('public.discovery_listings')=null`; migration `20261018131000` ausente do histórico (0 aplicações); `platform_launch_control` permanece `PRELAUNCH / commerce_enabled=false`; portais atestados em `433101839489` às 17:34 UTC. O leitor web não abriu os manifests HTTP individualmente; não tratar o atestado como verificação HTTP independente.
- **Correção proposta na mesma migration ainda não aplicada:** fotos somente em bucket específico `tamao-discovery-photos`, novas gravações sob diretório do `auth.uid()`, limite 5 MiB e MIME JPEG/PNG/WebP. Antes de aceitar `review` ou `published`, o banco verifica que cada chave `photo_urls` corresponde a objeto persistido nesse bucket e pertencente ao anunciante. URLs externas deixam de servir de prova de foto.
- **Interface pública:** apresentação de imagem aprovada a partir de chave Storage validada, sem aceitar endereço livre. Bucket é **público para fotos não sensíveis**; documentos e licenças requerem armazenamento privado próprio, ainda NÃO implementado.
- **Testes adicionados:** contrato de Storage em PostgreSQL descartável, recusa de link externo e upload em pasta de outra pessoa; contrato JS para evitar URL externa no `src`. Não confundir simulação SQL com upload binário real do Storage, verificação de tipo pelo conteúdo ou Auth E2E.
- **Falha detectada e resolvida durante desenvolvimento:** alteração de SQL com substituição de strings duplicou trechos da migration; arquivo restaurado a partir da versão aprovada, sem redundância (uma função de transição, dois gates de imagens). Outra falha no PostgreSQL isolado: `psql` não expande `:'variavel'` dentro de `DO $$`; teste corrigido no commit `ca8305bfd835a1f6bdca2700d8d6e5617d9571a2`. Reexecutar CI no SHA final e não presumir aprovação.
- **Mudanças nesta sessão:** somente commits na branch do PR #492; **nenhuma migration, deploy, comércio, pagamento ou nova vertical ativados no Supabase**.
- **Situação:** CORE-001/QA-001 continuam **PARCIAIS**. UI-001/PRO-001/RIDE-001/STAY-001/ADMIN-001 não são concluidos por esta etapa. A migração segue **não publicável**.
- **Primeira tarefa restante:** concluir jornadas autenticadas de criar/editar anúncios dos três tipos, upload pelo SDK real em nomes aleatórios, gestão de fotos, envio à revisão, aprovação/rejeição no admin existente, documentação privada, e E2E/isolamento de contas. Sem essas provas, não avançar para merge ou abertura de modalidades.
- **Gates específicos antes do release:** executar CI final por SHA, verificar cadastro/login/Supabase Storage real sem tocar produção aberta, garantir ausência de vazamento RLS/storage, testes de publicação/pausa, browser E2E, cobertura de layouts e reconciliação de portais. Não publicar por testes estáticos isolados.

## Continuação — área autenticada de anunciantes

- Implementada na branch canônica a base de `js/discovery-owner.js`: autenticação por e-mail (OTP), editor curto para Profissionais, Caronas e Hospedagens, rascunho, detalhes próprios por modalidade, upload de imagens em Storage, listagem de anúncios do usuário, envio para revisão e pausa pelo anunciante. Rotas `#advertise` e carregamento sob demanda no `js/bootstrap.js`; entrada na home; estilos responsivos; exclusão do bundle admin/revenda pelo build.
- A consulta privada `discovery_my_listings()` valida `auth.uid()` no SQL e não envia o campo `owner_id`; regressão de dois usuários adicionada ao PostgreSQL descartável. Não há publicação automática nem abertura de cidade.
- Novo gate `tests/discovery-owner-journey.mjs` na auditoria verifica autenticação, cadastro, detalhes, foto, envio a revisão, tipo de arquivo inválido, rota protegida e isolamento de assets. Trata-se de simulação determinística, **não** de Auth/Storage/E2E em ambiente Supabase real.
- Após adicionar a jornada, PostgreSQL isolado, build de portais e smoke visual passaram em `d886b53`. Audit falhou na etapa de sintaxe por expressão de teste inválida, corrigida em `7db2d672f37f268c2a7851e565f3982f4f63baf5`. Na execução seguinte, a auditoria identificou exigência do contrato de checkpoint para a expressão exata `ÚLTIMA ETAPA CONCLUÍDA`; restaurada nesta edição. Confirmar novos workflows após este checkpoint.
- **Ainda incompleto e sem publicação:** revisão/decisão pelo superadmin dentro do painel existente, gestão de documentos privados, critérios específicos legais, edição de fotos e remoção, antifraude, confirmação de comunicação de e-mail/redirect reais, upload de bytes reais e testes E2E multiusuário. O formulário/SDK é código proposto, não operação comprovada.
- **Próxima tarefa exata:** corrigir eventuais falhas do Audit no HEAD; integrar controle de moderação ao painel admin existente sem duplicar aplicação; testar fluxos completos de anunciante A, anunciante B, superadmin e visitante, incluindo falhas de rede e fotos. Manter PR #492 em draft e migration não aplicada.

## Checkpoint operacional obrigatório

**ÚLTIMA ETAPA CONCLUÍDA:** descoberta pública, protocolo de continuidade, PostgreSQL isolado e builds na SHA `2d31f63c6ea22a9985b590bc2820172777300a0f`. **NOVAS ALTERAÇÕES AINDA SEM GATE FINAL:** proteção de imagens, teste de Storage e renderização; conferir CI no HEAD deste checkpoint.

**ETAPA ATUAL:** Validar CI e integrações da primeira base de cadastro autenticado; iniciar moderação no admin existente; preservar todas as proteções antes do release.

**PRÓXIMA AÇÃO EXATA:** Conferir workflows da HEAD no GitHub, reparar falhas, implementar fila e decisão de revisão no superadmin existente, validar Auth e Storage real em homologação e adicionar E2E autenticado de criação → revisão → publicação → pausa, mantendo migração e cobrança desligadas em produção.

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
