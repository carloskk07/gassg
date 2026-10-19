# TAMÃO — Diário Oficial de Execução Técnica

**Iniciativa:** TAMÃO — Expansão Integrada e Consolidação para Produção  
**Última atualização:** 2026-10-18  
**Repositório:** `carloskk07/gassg`  
**Branch de integração:** `feat/unified-discovery-tamao`  
**Branch oficial:** `main`  
**Commit-base de `main`:** `433101839489f7739f44ddcf04e664ddff3435bd`  
**SHA da última revisão com auditoria completa aprovada:** `73100e0265306d2ffde9ee23ad26dede9b6ae83e`
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
| CORE-001 | PARCIAL | Busca e cadastro de anunciante em código, mídia e documentação privada protegida propostas; migration não aplicada, sem Auth/Storage real E2E |
| PRO-001 | PARCIAL | Busca pública por UF/cidade e contato WhatsApp na branch; sem cadastro/aprovação comercial |
| RIDE-001 | PARCIAL | Pesquisa por origem/destino, vagas e contato na branch; faltam anúncios, passageiros e moderação |
| STAY-001 | PARCIAL | Busca por cidade, UF e hóspedes na branch; faltam fotos, cadastro, datas, SEO e disponibilidade |
| UI-001 | PARCIAL | Cards e descoberta pública, editor de anunciante e moderação na área admin existentes na PR; avaliação UX real e E2E faltam |
| SEO-001 | NÃO INICIADA | Sem espanhol argentino indexável por destinos |
| ADS-001 | NÃO INICIADA | Integrar com Ads existente, sem duplicar cobranças |
| FIN-001 | NÃO INICIADA | Tabelas sem cobrança; faltam consentimento, tarifas, conciliação e testes |
| REP-001 | NÃO INICIADA | Avaliações autênticas, denúncias e antifraude ausentes |
| ADMIN-001 | PARCIAL | Fila, decisão auditada, controle de modalidade/cidade e consulta de documentos privados no admin existente; falta E2E real |
| QA-001 | PARCIAL | Audit, PostgreSQL, build e smoke público PASS em f1853346; Auth/Storage e E2E autenticados reais pendentes |
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


## Confirmação independente da produção preexistente (18/10/2026)

- Último atestado verificável no Supabase `platform_portal_attestations`: `2026-10-18T19:42:25Z`, 3 portais (`customer`, `merchant`, `admin`), todos `htmlStatus/buildStatus/runtimeStatus=200`, cada `sourceSha=433101839489f7739f44ddcf04e664ddff3435bd` e `allPortalsReady=true`; dados conferidos sem modificação de produção.
- Tentativa adicional de ler os 3 URLs de `portal-build.json` via leitor web e runtime local falhou por acesso/DNS; **atestado de banco não é inspeção HTTP direta contemporânea**. Reconciliar antes de liberar a expansão, com ambiente capaz de acesso externo.

## Continuação — comprovantes privados e moderação sem duplicação (18/10/2026)

- **Retomada exata:** PR #492, branch única; antes das novas alterações a SHA `f3e19e76fba7c5d42daf3b30ed51dd142bfc85c1` já continha fila de moderação no `js/admin.js` e os quatro workflows oficiais estavam PASS. Não recriar painel/PR/versão.
- **Banco real apenas leitura:** Supabase `lgugwujpunhslavewffd` tem 154 tabelas em `public`; `discovery_listings` e `discovery_documents` AUSENTES. `platform_launch_control` segue `PRELAUNCH`, `commerce_enabled=false`; 3 portais atestados no banco com `433101839489f7739f44ddcf04e664ddff3435bd` às `2026-10-18T19:42:25Z`. A leitura HTTP externa dos manifests não funcionou; atestado de banco não equivale a E2E.
- **Mudança de código (não publicada):** dentro da migration única já aberta, tabela imutável `discovery_documents`, bucket separado `tamao-discovery-documents` privado (até 10 MiB), RLS de dono/superadmin e pastas `ownerUUID/listingUUID/randomUUID`. Nenhum anonimato é autorizado e nenhum arquivo sensível entra no bucket público de fotos. Acesso temporário via URL assinada por 90 segundos somente após controle de Storage. Ainda faltam conservação, exclusão e verificação de conteúdo/MIME por bytes reais.
- **Jornada:** `js/discovery-owner.js` anexa PDF/imagens opcionais ao rascunho e registra metadados; `js/admin.js` mantém a fila original e adiciona consulta de documentação privada mediante sessão privilegiada. Testes `tests/discovery-owner-journey.mjs` e `tests/discovery-admin-journey.mjs` cobrem uploads simulados, domínio de URL assinada, papel administrador e fail-closed.
- **Falhas descobertas e corrigidas ANTES da produção:** consulta indevida a coluna interna por Storage RLS, ciclo de recursão Storage ↔ documentos e delimitadores SQL inválidos. Funções SECURITY DEFINER limitadas ao `auth.uid()`/superadmin quebram a recursão; regressão executada sobre PostgreSQL 17 descartável. Não executar esta migration em produção ainda.
- **Evidência no código e checkpoint `f185334626067f6cb9c8d8ea42bb4261573403d2`:** [PostgreSQL isolado PASS](https://github.com/carloskk07/gassg/actions/runs/39161654415), [Build portais PASS](https://github.com/carloskk07/gassg/actions/runs/39161654386), [smoke visual público PASS](https://github.com/carloskk07/gassg/actions/runs/39161654405) e [Audit PASS](https://github.com/carloskk07/gassg/actions/runs/39161654403). Nova edição documental exige nova conferência no novo HEAD; não confundir testes isolados com homologação real.
- **Endurecimento adicional do painel (continuação):** links de comprovantes privados assinados por 90 segundos passaram a solicitar `download:true`, em vez de abrir arquivos potencialmente não confiáveis inline no navegador do administrador. Regressão correspondente no `tests/discovery-admin-journey.mjs`. Código SHA `d86d058b173634af21f31de03f7b29360bdd1acf` com PostgreSQL, build e smoke PASS; confirmar Audit desse SHA e, depois, o CI do HEAD documental.
- **Sem alteração operacional:** não aplicar migration, não configurar cobrança, não abrir cidade/modalidade, não fazer merge, não promover preview Netlify ou Cloudflare.

## Decisão de acompanhamento dentro do TAMÃO (18/10/2026)

- **Decisão do proprietário:** não utilizar Slack nem criar sistema externo de acompanhamento. Reclamações, chamados e alertas de operação devem ser recebidos, triados e acompanhados dentro do TAMÃO, no painel de administração atual.
- **Infraestrutura reaproveitável comprovada por leitura:** `public.platform_incidents` e `public.support_cases` já existem na produção; `js/admin.js` contém seção `incidents` e formulário `adminCreateIncident`; `js/customer.js` já apresenta a rota de suporte `#customer-care` associada a pedidos. Não criar novas tabelas/painéis paralelos apenas para esta decisão.
- **Escopo registrado:** `docs/TAMAO_ESCOPO.md` agora inclui lançamento assistido e uma central de acompanhamento nativa. Ampliações necessárias para receber problemas de anúncios de Profissionais, Caronas e Hospedagens devem reutilizar fluxos existentes, com isolamento de dados e visibilidade administrativa.
- **Prova de limites:** nenhuma triagem automática contínua, alertas novos, captura de reclamações das novas modalidades ou dashboard unificado foi implementado nesta etapa. Não prometer monitoramento autônomo do assistente. Implementar e testar a coleta e o processamento internos antes de descrevê-los como ativos.
- **Estado da publicação:** apenas documentação na branch do PR #492; `main`, Supabase e cidades/modalidades sem alteração. Continuar o primeiro trabalho técnico pendente no checkpoint abaixo, sem nova versão sobreposta.

## Continuação — exclusão segura de comprovantes antes da revisão (18/10/2026)

- **Retomada e inventário:** PR canônica #492, branch `feat/unified-discovery-tamao`, sem branch/PR paralela. Base `main` confirmada em `433101839489f7739f44ddcf04e664ddff3435bd`; a PR estava 94 commits à frente da base quando recuperada.
- **Primeiro subproblema trabalhado:** não havia remoção pelo anunciante de comprovantes enviados indevidamente. Em `js/discovery-owner.js`, o editor agora oferece remoção somente para arquivos pertencentes ao anúncio em `draft` ou `rejected`. A operação primeiro chama `storage.from('tamao-discovery-documents').remove([path])`, depois remove metadados `discovery_documents` com confirmação de linha; perda de rede não informa sucesso.
- **RLS e integridade:** na mesma migration única ainda não aplicada, políticas `discovery_document_owner_delete` e `discovery_document_storage_delete` exigem proprietário autenticado e rascunho editável. Trigger `discovery_document_delete_after_storage` recusa apagar metadados enquanto `storage.objects` conservar o arquivo; impede que chamadas REST deixem bytes sem referência por exclusão invertida. Nenhuma permissão de UPDATE/upsert do Storage foi criada.
- **Regressões introduzidas:** `tests/discovery-owner-journey.mjs` cobre remoção do arquivo e seus metadados, além de falha de rede com preservação do registro; `tests/discovery-db-integration.sql` cobre exclusão positiva, tentativa prematura antes dos bytes e negativa entre contas. O PostgreSQL 17 isolado passou no código `8cfff7aa52c9870fcf214b631afccad012549dee`, assim como build dos portais e smoke público; o Audit desse SHA ainda estava em execução na última leitura. O Audit de `e6d0d976614c10a8d54e095caaac764258054c4a` estava PASS.
- **Código mais recente antes desta edição documental:** `7d45730946f5ba347191dd01b8ba901e6a34fdd3`, que adicionou o teste de indisponibilidade de rede. Exigir os quatro workflows oficiais PASS **nesse SHA ou no SHA deste checkpoint**. Não atribuir automaticamente a ele o PASS de uma revisão anterior.
- **Supabase real, só leitura:** projeto `lgugwujpunhslavewffd` ACTIVE_HEALTHY, `discovery_listings` e `discovery_documents` ausentes, migração `20261018131000` aplicada zero vezes; `platform_launch_control` em `PRELAUNCH`, `commerce_enabled=false`. Último atestado de portais no banco em `2026-10-18T19:42:25Z` aponta os três portais para `433101839489`, com 200 nos verificadores; HTTP direto de cada `portal-build.json` foi tentado e não acessível neste ambiente.
- **Limites ainda importantes:** essa é eliminação manual pré-revisão, **não** política completa de retenção, expurgo pós-revisão ou detecção de arquivos órfãos em falhas após upload. Ainda não ocorreu upload de bytes, OTP ou RLS com Auth/Storage reais, nem E2E em navegadores com atores A/B/superadmin/visitante.
- **Próxima ação exata:** verificar Audit/PostgreSQL/build/smoke no HEAD atualizado, corrigir qualquer regressão antes de outras alterações; em seguida preparar testes reais isolados de Auth/Storage e ciclo de criação → moderação → publicação → pausa, além de tratamento para upload incompleto e política documentada de retenção/remoção. Sem merge, migration de produção, ativação ou cobrança.

## Continuação — compensação de uploads interrompidos (18/10/2026)

- **Retomada:** PR #492 ainda aberta/draft; branch única `feat/unified-discovery-tamao`; código anterior `7ccae06fce234f2b380d5e346684297040b45b4b` validado. Sem merge ou nova versão sobreposta.
- **Defeito confirmado em `js/discovery-owner.js`:** após o Storage aceitar um comprovante, uma falha no INSERT de `discovery_documents` podia deixar bytes privados órfãos, sem associação a anúncio. Agora há compensação chamando `storage.remove()` quando o registro falha. Caso a limpeza também falhe, não informa sucesso e avisa explicitamente sobre pendência de conferência, sem divulgar a chave do objeto.
- **Defeito análogo para fotos públicas:** o editor agora rastreia cada chave de upload tentado e compensa com Storage API se o upload ou a atualização `discovery_listings.photo_urls` falhar. Em caso de resposta ambígua da atualização, a RLS impede remover qualquer foto que já tenha sido vinculada ao anúncio, inclusive se a resposta de rede foi perdida.
- **Migration única, ainda não aplicada:** função `discovery_photo_unreferenced` (SECURITY DEFINER ligada ao `auth.uid()`) e políticas `discovery_photo_owner_read` e `discovery_photo_orphan_cleanup` autorizam remover somente objetos de foto do próprio usuário **sem referência** em suas listagens. Documentos continuam usando armazenamento privado, política de dono editável e trigger que impede excluir o registro antes dos bytes.
- **Testes:** `tests/discovery-owner-journey.mjs` exercita INSERT de documento falho, compensação de Storage, falha dupla de rede, gravação final de fotos falha e proteção de fotos preexistentes; `tests/discovery-db-integration.sql` confirma veto à exclusão de foto referenciada, veto a outra conta e permissão de excluir foto órfã do próprio usuário. Chaves de teste agora são únicas, para evitar simulação indevida de `upsert`.
- **CI integral do código `7fbf28217d3e20e20a29368ef6e89046b6db759c`:** [Audit PASS](https://github.com/carloskk07/gassg/actions/runs/39168357464), [PostgreSQL 17 isolado PASS](https://github.com/carloskk07/gassg/actions/runs/39168357512), [Build dos portais PASS](https://github.com/carloskk07/gassg/actions/runs/39168357472), [smoke público PASS](https://github.com/carloskk07/gassg/actions/runs/39168357493). São provas automatizadas **desse código**, não prova de Auth/Storage real.
- **Ambiente:** Supabase de produção `lgugwujpunhslavewffd` em leitura, sem `discovery_listings` ou `discovery_documents`, migration `20261018131000` zero aplicações, `PRELAUNCH`, `commerce_enabled=false`. Consulta de branches mostrou somente o branch principal do projeto, sem homologação separada já existente. Não criar branch faturável sem aceite de custo nem fazer upload de testes na produção.
- **Portais:** URLs `tamao.com.br/portal-build.json`, `parceiro.tamao.com.br/portal-build.json` e `admin.tamao.com.br/portal-build.json` foram tentados novamente, mas não puderam ser consultados diretamente; atestado do banco em `433101839489` não equivale a inspeção HTTP contemporânea.
- **Limites residuais:** não foram executados login/OTP real, upload de bytes reais, sessão A/B/admin, URLs assinadas, moderação Auth real, e2e em navegador real com Storage, nem expurgo/reconciliação de objetos sem vínculo após falha dupla (a UI somente sinaliza incerteza). Também falta decisão e implementação de retenção, exclusão após revisão e eventual gestão de fotos pelo anunciante. Não classificar esses itens como completos.
- **Próxima ação exata:** verificar o CI do commit documental; preparar/usar homologação independente sem tocar produção (isolada e sem custo inesperado), executar ciclo A/B/superadmin/visitante com Auth/Storage reais e validar atualização/delete com falhas de rede; então implantar reconciliação segura de órfãos/retention e completar publicação/pausa E2E. Sem merge nem abertura comercial antes do gate mínimo.

## META COMERCIAL DE QUARTA-FEIRA, 21/10/2026 — lançamento assistido do marketplace atual

**Decisão expressa do responsável em 18/10/2026:** antecipar a meta da operação comercial real assistida do TAMÃO atual em São Gabriel/RS para **quarta-feira, 21 de outubro de 2026**, preservando todos os gates mínimos de segurança. **Esse prazo não inclui a conclusão integral das modalidades Profissionais, Caronas e Hospedagens**, que seguem apenas na PR #492. Não criar versões paralelas nem cobrar assinatura Pro.

**Agenda mandatória da issue #493:** 19/10 — revenda, compliance, preços, estoque e entrega; 20/10 — jornada de pedido, identidade/RLS, pausa, incidentes e reconciliação dos portais; **21/10 — decisão administrativa e abertura assistida somente se o gate estiver PASS e a revenda operacional**; 22–25/10 — corrigir incidentes do uso real e amadurecer a operação.

**Bloqueios conhecidos em 18/10:** revenda `pending`, preço não confirmado, CNPJ/ANP ainda `pending`, São Gabriel `commerce_enabled=false`, plataforma `PRELAUNCH`, nenhum pedido real registrado. Não presumir que esses dados continuam atuais; consultar novamente antes de agir. A solicitação de revenda `approved` não confirma habilitação operacional.

**Fluxo de continuação:** ao receber o prompt antigo ou atualizado em uma nova conversa, ler este checkpoint e issue #493 e **priorizar o prazo de 21/10**, sem precisar que o usuário cole o Superprompt Mestre integral. Não contornar aprovações, inventar preços, testar dinheiro real sem autorização nem publicar em estado inseguro.

**Meta e não garantia:** se o gate mínimo estiver reprovado, manter o bloqueio e informar ao responsável exatamente qual verificação impede a abertura; concluir a primeira correção possível. O selo `TAMÃO — PRONTO PARA PRODUÇÃO REAL` continua reservado para o projeto integral.

### Diagnóstico detalhado da janela comercial (19–25/10/2026)

**Decisão de 18/10/2026:** não comprar plano Pro; usar as ferramentas existentes com máxima eficiência. **Prioridade comercial:** iniciar a operação assistida do marketplace de produtos que já existe, sem esperar a conclusão dos módulos Profissionais, Caronas e Hospedagens. Esse objetivo não autoriza ativar comércio sem testes mínimos, preços reais e decisão do superadmin.

- **Registro operacional persistente:** [GitHub issue #493](https://github.com/carloskk07/gassg/issues/493), com plano datado e checklist. Não criar outra issue/PR para esse mesmo objetivo; atualizar a #493 ao avançar.
- **Verificação por SQL em 18/10/2026 (somente leitura):** Supabase `ACTIVE_HEALTHY`; `platform_launch_control` em `PRELAUNCH`, `commerce_enabled=false`; São Gabriel/RS com `market_cities.commerce_enabled=false`; **1 revenda** com `status=pending`, preços **não confirmados**, taxa de entrega confirmada, atendimento à cidade inteira declarado e capacidade de 8 pedidos ativos; **1 solicitação** de revenda `approved`; **0 pedidos**; **0 incidentes**; **0 chamados de suporte**. Uma solicitação aprovada não prova revenda operacional.
- **Primeiro bloqueio concreto do lançamento:** concluir ativação legítima da revenda e confirmar preços/estoque/condições de entrega, com evidências reais. Não escrever preços arbitrários nem alterar `status` diretamente no banco para contornar o fluxo do administrador.
- **Segunda etapa:** validar autenticação, compra → aceite → entrega, isolamento de contas, idempotência, suspensão, canal de incidentes existente e reconciliação HTTP/manifest dos três portais. Não executar pagamento real de teste sem autorização.
- **Terceira etapa:** preparar decisão expressa do superadmin para ativar São Gabriel somente após aprovação do gate mínimo; validar comportamento pós-abertura e registrar evidências.
- **Expansão técnica em paralelo:** conservar a PR #492 em rascunho e sua migration **não aplicada**, sem liberar modos novos incompletos. Manter o checkpoint e gates próprios da expansão. A conclusão da issue #493 (operação assistida) **não equivale** ao selo global de produção integral.

**PRÓXIMA AÇÃO DA FRENTE COMERCIAL:** verificar no painel oficial a revenda `pending` e preços não confirmados, diagnosticar o caminho de ativação do superadmin e executar testes mínimos da compra sem afetar operações reais. Atualizar a issue #493 e este diário com resultado verificável.

## Checkpoint operacional obrigatório

**ÚLTIMA ETAPA CONCLUÍDA:** correção de navegação pública estável, preboot claro e contratos de regressão atualizados no código `73100e0265306d2ffde9ee23ad26dede9b6ae83e`. Quatro gates oficiais PASS nesse SHA (Audit 317 etapas, PostgreSQL 17, build isolado, smoke visual). Verificação comercial real em leitura: revenda `pending`/offline e CNPJ/ANP `pending`; não publicada nem ativada. Próximo commit documental requer nova CI.

**ETAPA ATUAL:** PRIORIDADE issue #493: concluir compliance, preço geral e ativação legítima da revenda, teste E2E do pedido e pausa para decisão administrativa até 21/10. Em paralelo: expansão sem publicação, Auth/Storage isolados, retenção e expurgo, reconciliação de objetos órfãos e E2E A/B/superadmin/visitante.

**PRÓXIMA AÇÃO EXATA:** na frente comercial, responsável e superadmin validarem representação, CNPJ/ANP, pagamentos, preços atuais, logística e presença online da revenda; seguir a ativação oficial e testar compra/aceite/entrega, RLS/idempotência, pausa, incidentes e reconciliação HTTP antes de autorizar São Gabriel. Em paralelo, habilitar homologação Auth/Storage independente sem custos extras e executar A/B/admin/visitante antes de publicar novas modalidades.

**ARQUIVOS QUE DEVEM SER INSPECIONADOS:** `js/core.js`, `index.html`, `css/marketing-premium.css`, `tests/public-navigation-stability.mjs`, `tests/public-marketing-v1-362.mjs`, `tests/production-language-v1-147.mjs`, `supabase/migrations/20261018131000_discovery_shared_verticals.sql`, `js/discovery-owner.js`, `js/admin.js`, `js/discovery.js`, `js/bootstrap.js`, `js/customer.js`, `scripts/build-live-portals.mjs`, `tests/discovery-owner-journey.mjs`, `tests/discovery-admin-journey.mjs`, `tests/discovery-db-integration.sql`, `docs/TAMAO_ESCOPO.md`.

**TESTES QUE DEVEM SER EXECUTADOS:** `node tests/public-navigation-stability.mjs`, `node tests/public-marketing-v1-362.mjs`, `node tests/production-language-v1-147.mjs`, `node tests/discovery-owner-journey.mjs`, `node tests/discovery-admin-journey.mjs`, `node tests/discovery-public-journeys.mjs`, `node tests/discovery-shared-verticals.mjs`, `node tests/portal-performance-budget.mjs`, workflows `Audit`, `Build isolated live portals`, `TAMÃO discovery PostgreSQL contract` e `TAMÃO public visual smoke`; depois E2E Auth/Storage com usuários reais de homologação.

**BLOQUEIOS CONHECIDOS:** Migração e anúncios não existem em produção; Auth/Storage multiusuário real, verificação de arquivos binários, políticas de retenção/remoção, validação legal por modalidade, Cobrança Impulso, reputação, SEO argentino, regressões e E2E completos permanecem pendentes. Leitura HTTP direta dos três manifests não foi possível; apenas atestado de SHA no Supabase.

**CONDIÇÃO DE CONCLUSÃO:** Para cada vertical, cadastro, autorização, publicação, busca, contato e operação testados; para release, zero P0/P1 conhecidos, recuperação comprovada, migrações e portais reconciliados por SHA e autorização comercial do superadmin.

## Decisão — cadastro livre de novas revendas sem dependência do primeiro parceiro (18/10/2026)

- **Orientação comercial:** a primeira revenda não deve travar apresentação, prospecção nem o cadastro de outras empresas. Tratar sua regularização como assunto operacional próprio, sem declarar no banco que uma conferência inexistente foi concluída.
- **Regra de simplicidade:** interessado entra diretamente em `parceiro.tamao.com.br/#merchant-join`, confirma e-mail, preenche cadastro existente e pode corrigi-lo; **não precisa de convite do administrador**, nem preencher antes uma segunda ficha de interesse. A conferência comercial/identidade é separada da captação; produtos sujeitos a licenças e pagamentos continuam com salvaguardas legais e financeiras.
- **Defeito de conversão identificado e corrigido nesta branch:** o `merchantSendLogin` limpava o hash para permitir retorno de tokens OTP e perdia o marcador `merchant-join` quando o usuário clicava no link de e-mail. Agora o `emailRedirectTo` transporta somente `signup=1` na query, sem credenciais; `js/bootstrap.js` retoma a página de cadastro para conta autenticada sem revenda, mesmo sem convite. Contas que já têm revenda continuam no painel; convites existentes preservados.
- **Teste aprimorado:** `tests/merchant-direct-onboarding-v1-410.mjs` inclui OTP realista em VM e retomada sem convite, com regressão para login normal, usuário existente e convite piloto. **CI no novo SHA deve ser consultado antes de classificar como PASS**.
- **Prioridade até quarta 21/10:** permitir apresentar o TAMÃO e cadastrar várias revendas sem esperar o primeiro parceiro; comprovar OTP via serviço real e submissão pelo portal, qualidade de painéis e pedidos existentes, não automatizar habilitação comercial por simples registro.
- **Estado de publicação:** esta alteração está somente na PR #492 em rascunho, sem mudanças na `main`, Supabase ou portais. O lançamento real continua sujeito aos testes críticos e autorização do superadmin.

## Lançamento gradual — hotfix de cadastro integrado na main (18/10/2026)

- **Entrega real concluída no GitHub:** PR [#494](https://github.com/carloskk07/gassg/pull/494) (extração cirúrgica do cadastro pós-OTP sem convite) passou Audit e build de três portais, integrada à `main` pelo commit `a254ad7fee425271958f79eb2dbacc9c0cc0dd73`. Somente `js/backend.js`, `js/bootstrap.js` e `tests/merchant-direct-onboarding-v1-410.mjs` mudaram na main. **Produção só está comprovada depois do gate oficial Cloudflare e dos três portais responderem o mesmo SHA**.
- **Sem duplicação de implementação:** a PR #492 já contém a mesma correção (seu `backend.js` e teste são idênticos ao hotfix; o `bootstrap.js` mantém a variante `returningToSignup` com condição equivalente, além dos reparos visuais próprios da expansão). A reconciliação histórica com a `main` usa commit de merge com a árvore existente da PR, sem reaplicar alterações nem integrar módulos novos na produção.
- **Foco até 21/10:** várias revendas podem solicitar cadastro antes da liberação comercial da primeira; testar OTP real em navegador/email, envio e recuperação da solicitação, painel do administrador e o primeiro pedido autorizado. Não falsificar habilitação, preços, estoque, CNPJ, ANP ou pagamentos.
- **Ações pendentes:** confirmar workflow de deploy e evidência real SHA dos três portais; checar PR #492 em CI após reconciliação; concluir revisão visual do preboot/menu já corrigido na expansão e extrair somente correções verificadas para lançamento.

## Correção da primeira pintura e menus aprovada e integrada (18/10/2026)

- **Entregue pela PR #495**, commit `7272725b8f98608e1686bfe059fee569dfd8b0a5` na `main`: preboot claro, rótulos iniciais consistentes, navegação desktop/mobile estável com ação “Consultar” contextual no clique. Os controles de loja/checkout permanecem fechados sem oferta real.
- A PR #495 isolou apenas 9 arquivos de UI/testes e passou dois Audits, build dos portais e smoke visual antes do merge. **Checar publicação real nos três domínios e atestado do SHA antes de afirmar implantação concluída.**
- A PR de expansão #492 já possuía a mesma implementação de UI, por isso este merge histórico preserva a árvore de código da iniciativa, incorporando a atualização do teste de benefícios `tests/public-benefits-first-v1-405.mjs` que precisa reconhecer o rótulo “Indicações” em vez da referência antiga. A PR #492 segue draft, sem aplicação da migration de expansão.
- **Trabalho restante para a meta de 21/10:** validar cadastro comercial real de duas novas revendas (OTP, ficha, acompanhamento, backoffice) e ofertas/pedidos com revenda efetivamente habilitada e autorização do administrador. Comunicação de disponibilidade real, sem fingir pagamento ou operação.

## Como retomar após interrupção

1. Ler este arquivo e o escopo, sem confiar somente em memória.
2. Comparar PR #492 com o estado atual da `main`, obter SHA da branch.
3. Conferir workflow `Audit` e testes PostgreSQL na SHA atual.
4. Consultar migrações, controles e funções existentes no Supabase **sem repetir aplicações**.
5. Executar a próxima ação exata, registrar defeito e teste de regressão, atualizar este checkpoint.
6. Não criar nova branch/PR para mesma expansão ou liberar anúncio incompleto.

## Continuação 18/10/2026 — operação assistida e navegação estável

- Consulta atual do Supabase: `ACTIVE_HEALTHY`, plataforma `PRELAUNCH` e `commerce_enabled=false`; São Gabriel/RS sem abertura; revenda única `pending`, offline, sem confirmação geral de preços; CNPJ/ANP `pending`. Há 3 itens ativos com preço individual confirmado e estoque positivo; ainda **não constituem oferta habilitada**. Pedidos e incidentes: zero.
- Último atestado OIDC no banco às `2026-10-18T21:56:09Z`: customer, merchant e admin com respostas 200 registradas no SHA `433101839489`. Teste HTTP independente do ambiente falhou por DNS; **não** validar implantação apenas com atestado.
- CI anterior do HEAD `29d43df`: Audit, PostgreSQL 17 isolado, builds e smoke público PASS. Branch 118 commits à frente da `main` antes desta edição.
- Defeito priorizado da issue #493: menu desktop/mobile mudava com a disponibilidade assíncrona; conteúdo inicial trazia links com outros rótulos e fundo verde. Alteração proposta **somente nesta PR draft**: menus estáveis, verificação de disponibilidade no clique, rótulos coerentes e fundo inicial claro; nova regressão `tests/public-navigation-stability.mjs` no Audit. **Aguardando CI do novo HEAD e revisão visual antes de extração/publicação**.
- Não criar/comprar/faturar pedidos ou alterar status de revenda e abertura de cidade por SQL. O primeiro passo continua sendo validar representação, CNPJ/ANP quando aplicáveis, preços gerais, pagamento, logística e online pelo painel e responsável real; depois testar jornada de pedido e pausa.
- Expansão continua dependente de Auth/Storage reais A/B/admin isolados, retenção e órfãos, publicação/pausa E2E, SEO `es-AR`, Ads/Impulso e demais critérios. Migration `20261018131000` permanece **não aplicada**. PR não deve ser integrada.

## Fechamento técnico verificável — 18/10/2026 (issue #493)

- Correção proposta na única branch de integração, último **SHA de código validado** `73100e0265306d2ffde9ee23ad26dede9b6ae83e`: menus público desktop/mobile estáveis independentemente do estado assíncrono de supply; CTA Consultar protegido por consulta no clique; primeira pintura clara; links do HTML inicial atualizados; novos e antigos testes de regressão compatibilizados sem enfraquecer o bloqueio real de checkout.
- **PASS na revisão de código `73100e0265306d2ffde9ee23ad26dede9b6ae83e`:** Audit [39173060832](https://github.com/carloskk07/gassg/actions/runs/39173060832) (317 etapas), PostgreSQL 17 [39173060843](https://github.com/carloskk07/gassg/actions/runs/39173060843), build três portais [39173060830](https://github.com/carloskk07/gassg/actions/runs/39173060830), smoke visual [39173060834](https://github.com/carloskk07/gassg/actions/runs/39173060834). Execução independente em navegador de produção e experiência do usuário real ainda não realizada.
- **Issue comercial atualizada:** [comentário com evidência e impedimentos](https://github.com/carloskk07/gassg/issues/493#issuecomment-6256052973). 1 revenda ainda pendente/offline, preço geral pendente, 3 produtos individuais confirmados e estoque positivo, CNPJ/ANP pendentes, São Gabriel bloqueada, 0 pedidos. Quem autoriza é o superadmin mediante condições reais, não uma alteração SQL de conveniência.
- **Alertas adicionais de advisors:** 154 tabelas RLS sem políticas (INFO, padrão restritivo existente), 2 funções SECURITY DEFINER executáveis por `authenticated` (WARN, verificar intenção e autorização), Auth proteção contra senhas vazadas (WARN), índices de FK não cobertos (INFO). Revisar sem revogação cega que derrube funções legítimas; nenhum DDL aplicado.
- **Estado de produção preservado:** `main` em `433101839489f7739f44ddcf04e664ddff3435bd`, atestado bancário dos três portais às `2026-10-18T21:56:09Z`; HTTP externo dos manifests indisponível para este ambiente. `platform_launch_control` segue `PRELAUNCH/false`, migração de expansão não aplicada. **A branch não foi integrada ou implantada.**
- **Escopo ainda pendente:** marketplaces Profissionais, Caronas, Hospedagens, Ads/Impulso, SEO internacional, moderação E2E real, finanças e privacidade completa. A próxima conversa deve continuar o **bloqueio comercial da issue #493** antes de propor novos módulos ou abrir qualquer cidade.

## Auditoria CI e revisão do contrato de OTP — 18/10/2026

- O commit `db13aa2451b145f4760d80dc2e00af2973297b3d` passou em PostgreSQL 17, build isolado dos três portais e smoke público, mas o workflow Audit apontou falha em `tests/static-audit.mjs:1403`: a asserção exigia exatamente o antigo texto `invitedPartner&&...`, que deixou de corresponder após adicionar a retomada de cadastro `(invitedPartner||returningToSignup)`.
- A correção deste commit atualiza a auditoria **sem enfraquecer o controle**: exige token de convite preexistente, marcador de cadastro explícito, estado `no-access` e navegação somente para o formulário, sem ativação comercial. A regressão com VM em `tests/merchant-direct-onboarding-v1-410.mjs` continua cobrindo retorno OTP com e sem convite.
- **Próxima ação:** conferir Audit/PG17/build/smoke no novo HEAD antes de marcar como PASS. Sem implantação, mudança de banco ou reclassificação artificial de nenhuma revenda.



## Continuação comercial verificada — sessão 18/10/2026 à noite (issue #493)

**ÚLTIMA ETAPA CONCLUÍDA:** correção e teste de regressão do cadastro seguro de revendas na branch existente. `js/growth.js` agora recusa exibir formulário da empresa se a origem não é segura, a autenticação está indisponível ou a consulta das inscrições anteriores falhou. Origem insegura conserva o bloqueio do portal; falhas temporárias exibem erro e recarregamento, sem informar sucesso. `tests/merchant-direct-onboarding-v1-410.mjs` cobre os casos por VM, preservando o fluxo OTP normal. Commit de código e teste: `3847c0573715b4f277ddc97f2f342b45f35f2e53`.

**Gates desse SHA:** Audit PASS (`39182440785`), PostgreSQL 17 isolado PASS (`39182440939`), build dos três portais PASS (`39182440840`), smoke visual público PASS (`39182440946`). Revisão de release-candidate sem deploy ficou SKIPPED. Nenhum merge/deploy desta correção ocorreu.

**Supabase real (leitura):** `lgugwujpunhslavewffd` ACTIVE_HEALTHY. Edge Function `submit-merchant-application` v19 ACTIVE. `discovery_listings` e `discovery_documents` não existem; migração da expansão não aplicada. `platform_launch_control` PRELAUNCH / `commerce_enabled=false`. São Gabriel/RS `commerce_enabled=false`, sem pausa administrativa. Atestado interno de 3 portais aponta SHA `7272725b8f98608e1686bfe059fee569dfd8b0a5` em `2026-10-19T00:35:48Z`, não substitui HTTP real.

**Comércio:** 1 revenda `pending` e offline; 1 solicitação `approved`; 0 pedidos, 0 incidentes, 0 casos de suporte. Há responsável ativo, pagamento habilitado e 3 itens ativos com preço positivo e estoque, mas **zero preços atualizados confirmados nas últimas 24h**; preço geral sem confirmação; taxa de entrega já confirmada porém sem frescor de 24h, nenhuma presença recente, representação não verificada e CNPJ/ANP `pending`. Não alterar status/validações artificialmente.

**Portais:** acesso web direto aos três `portal-build.json` não foi possível via leitor externo; atestado do banco e deploy antigo Netlify admin `ready` não são inspeção HTTP contemporânea dos domínios oficiais.

**ETAPA ATUAL:** garantir inscrições reais de múltiplas revendas sem convite, sem confundir solicitação aprovada com aptidão para vender. A correção segue apenas na PR #492; Auth/OTP real com duas contas e análise administrativa não foram realizados nesta sessão. Não afirmar E2E homologado.

**PRÓXIMA AÇÃO OBJETIVA:** com contas reais, exercer duas inscrições distintas, retorno OTP, alteração/correção, revisão/vínculo superadmin e isolamento de dados; depois extrair/publicar somente correções comerciais testadas, sem publicar as modalidades incompletas. Responsável da revenda deve validar representação, CNPJ/ANP aplicáveis, preços frescos, estoque, entrega e online. Só então testar pedido assistido autorizado, pausa, recuperação e observabilidade. Continuar Profissionais, Caronas, Hospedagens, SEO e Ads na mesma PR, mantendo a migration de expansão não aplicada. Sem compras nem pagamentos reais não autorizados.


## Entrega comercial isolada concluída — PR #496 (18/10/2026)

**ÚLTIMA ETAPA CONCLUÍDA:** release mínimo da recuperação segura do cadastro de revendas foi extraído da integração (sem recriar expansão), pela [PR #496](https://github.com/carloskk07/gassg/pull/496), exatamente nos arquivos `js/growth.js` e `tests/merchant-direct-onboarding-v1-410.mjs`. Audit PASS `39183290738` e build isolado dos três portais PASS `39183290548` no HEAD `f1b80707e0093ec0cdf58c286bd82ab69243d4a3`. Smoke público e PG17 não dispararam no PR estreito por seus filtros de arquivos; esses gates já tinham PASS na revisão idêntica da branch da expansão `3847c05` e no checkpoint `4aa7614`.

**Merge oficial realizado:** PR #496 integrada por squash à `main` no commit `6a13bb29acf8d170556927df0cec2ea727ae7077`. Sem migração, Edge Function, mudança comercial, preço artificial, ativação ou cobrança. A PR #492 permanece rascunho e não publicada; seu HEAD anterior ao novo checkpoint era `4aa7614afb80f9fed55625a6ce1b0621deca6b17`, 130 commits à frente e 1 atrás da `main` porque o hotfix foi integrado isoladamente; as versões atuais dos dois arquivos coincidem com a `main`. Reconciliar o histórico da branch com `main` antes de integração futura, evitando duplicação; não fazer reset forçado.

**Evidência de portais após merge:** atestado OIDC interno em `public.platform_portal_attestations` para SHA `6a13bb29acf8d170556927df0cec2ea727ae7077` às `2026-10-19T01:03:26Z`, originado de `.github/workflows/launch-readiness.yml`, run `39183489357`; 3 entradas `customer`, `merchant`, `admin` com `htmlStatus=200`, `buildStatus=200`, `runtimeStatus=200`, `turnstileProduction=true`, `expectedSourceMatches=true`, `allPortalsReady=true`. `platform_launch_control.portals_source_sha` também foi atualizado para este SHA. Trata-se de atestado de rede emitido pelo workflow, não de login real em navegador nesta conversa; o leitor HTTP externo dos manifests permaneceu indisponível.

**Operação ainda bloqueada:** `platform_launch_control.operation_mode=PRELAUNCH`, `commerce_enabled=false`; marketplace São Gabriel fechado. Não usar o sucesso do deploy como evidência de disponibilidade de ofertas ou aprovação de revenda. Continua faltando autenticação/OTP real com duas contas, inscrição/edição com contas distintas, revisão superadmin, isolamento e registro de evidência de fluxo, bem como habilitação operacional legítima e primeiro pedido assistido autorizado.

**PRÓXIMA AÇÃO EXATA:** validar manualmente a jornada curta de duas contas reais e revisar casos pelo superadmin, com dados privados omitidos de issues; testar retorno OTP e recarga/recuperação. Tratar bloqueios específicos identificados, sem abrir a cidade por SQL. Em paralelo, retomar a expansão na PR #492 (Profissionais/Caronas/Hospedagens/SEO/Ads) e reconciliar o histórico de `main` antes de qualquer eventual merge. Migração `20261018131000` permanece não aplicada.


## Continuação da expansão — filtro de partida em Caronas (18/10/2026)

**ÚLTIMA ETAPA CONCLUÍDA:** continuação funcional da PR #492 sem misturar release comercial. `js/discovery.js` ganhou campo público de data/hora **Saída a partir de** somente na rota Caronas; parâmetro `p_departure_after` já era aceito por `discovery_public_search` na migration existente. Horário escolhido em `datetime-local` é convertido para ISO UTC para a busca. Hospedagens e Profissionais não recebem filtro de partida. `tests/discovery-public-journeys.mjs` cobre UI, parâmetro UTC e isolamento entre modalidades. Código/teste revisado: `1601b28050fb5a30dfdeb01fd13c357d8a994e65`.

**Gates no SHA `1601b2805`:** Audit PASS (run `39183930937`), PostgreSQL 17 isolado PASS (`39183930950`), build de três portais PASS (`39183931086`), smoke visual público PASS (`39183931004`). Revisão candidata sem deploy SKIPPED. **Apenas branch draft:** o filtro NÃO está em produção; a migration da expansão permanece NÃO aplicada.

**Comércio/produção preservados:** PR comercial [#496](https://github.com/carloskk07/gassg/pull/496) já integrada à `main` em `6a13bb29acf8d170556927df0cec2ea727ae7077` e atestada por OIDC com 3 portais HTTP 200. Plataforma/São Gabriel não abertas, OTP real com duas revendas ainda não homologado; issue #493 continua prioritária. O histórico da PR #492 divergiu um commit de `main` após squash de hotfix, embora os dois arquivos extraídos coincidam em conteúdo; não forçar reset do ramo.

**ETAPA ATUAL / PRÓXIMA AÇÃO:** validar cadastros reais de duas revendas independentes, revisão do superadmin e oferta pronta para primeiro pedido autorizado, sem pagamentos simulados nem abertura antecipada. Na expansão, continuar o fluxo de Hospedagens e Profissionais, disponibilidade/datas declaradas, SEO internacional e publicidade na mesma PR, respeitando Auth/Storage real A/B/admin antes de publicar. Antes de eventual merge da PR #492, reconciliar a `main` sem descartar commits nem duplicar implementações.


## Continuação comercial — múltiplas empresas por conta, sem duplicar cadastro (18/10/2026)

**Retomada e prioridade:** PR #492 draft, branch `feat/unified-discovery-tamao`, escopo e arquitetura consultados. Último checkpoint de código anterior `aa7a53f58d4b15a36ed83ba241ed111b9adc63cb` tinha quatro workflows oficiais PASS. `main` em `6a13bb29acf8d170556927df0cec2ea727ae7077`, atestada para os três portais; squash comercial #496 deixou a branch de expansão divergente 1 commit no histórico, sem reset forçado nem migration aplicada.

**Defeito concreto:** o banco ativo `merchant_applications` possui unicidade `(applicant_user_id, cnpj)`, portanto aceita várias empresas distintas por usuário, mas `merchantOwnApplicationForInvite()` selecionava sempre o primeiro registro, e a interface impedia o proprietário de avançar com outro CNPJ após uma inscrição aprovada. A UX não explorava a estrutura existente.

**Correção proposta somente na PR #492:** `js/backend.js` mantém seleção efêmera de application ID, prioriza convite CNPJ quando houver, só escolhe dentro de `ownApplications` devolvida para a sessão atual, e reseta estado no logout. `js/growth.js` inclui seletor entre inscrições existentes e 'Cadastrar outra empresa', sem reaproveitar dados do CNPJ anterior, com navegação para o formulário; `js/merchant.js` abre esse caminho até quando a inscrição anterior foi aprovada e ainda não existe acesso operacional; `js/bootstrap.js` disponibiliza o handler com a navegação existente. Em envio confirmado, o formulário seleciona a inscrição resultante. Nenhuma permissão, revisão, faturamento ou autorização comercial foi relaxada.

**Regressão:** `tests/merchant-direct-onboarding-v1-410.mjs` agora testa dois cadastros da mesma conta, seleção de inscrição aprovada, novo formulário em branco, rejeição de ID estranho, precedência do convite existente e restauração de seleção legítima. SHA mais recente do código/teste: `342ac69d29eeedc8e1a1a3899f6b351ecd140311`.

**Validação disponível nesta sessão:** compilação sintática direta dos quatro scripts JS alterados PASS; ensaio isolado com duas empresas e uma seleção inválida PASS, inclusive botão vindo do painel no estado `no-access`. Não se tratou de CI GitHub, teste real de OTP nem ensaio browser com contas reais. `fetch_commit_workflow_runs` retornou `[]` no último SHA consultado; não declarar Audit/build/PG/smoke desta revisão como aprovados. Publicação condicionada ao CI final.

**Estado real read-only:** Supabase `lgugwujpunhslavewffd` mantém `PRELAUNCH` / comércio desabilitado; 1 merchant `pending`/offline e sem confirmação geral de preços; 1 application; 0 pedidos, 0 incidentes, 0 casos de suporte; `discovery_listings` ausente e migration `20261018131000` não aplicada. Último atestado de portais em `6a13bb29acf8` (run OIDC). Nenhuma escrita no banco e nenhuma nova cidade/modalidade ativada.

**ETAPA ATUAL:** checar CI da revisão, corrigir eventual falha e executar fluxo autenticado com pelo menos duas revendas distintas, sua análise administrativa e isolamento. Se a correção estreita estiver comprovada, extrair release comercial seguro sem transportar a expansão. Depois validar oferta, preços frescos, entrega, compliance e primeiro pedido autorizado. Continuar Profissionais/Caronas/Hospedagens/SEO/Ads na mesma PR, sem cobrança nem módulos incompletos em produção.


## Entrega comercial multiempresa — PR #497 integrada (18/10/2026)

- **Entrega comercial segregada da expansão:** extraída a correção de seleção de inscrições na PR [#497](https://github.com/carloskk07/gassg/pull/497). O diff da PR tinha exatamente 5 arquivos (`js/backend.js`, `js/bootstrap.js`, `js/growth.js`, `js/merchant.js`, `tests/merchant-direct-onboarding-v1-410.mjs`), sem migração, cobrança ou função Supabase. Alterações de código empresarial equivalentes à branch canônica, com o bootstrap limitado ao novo handler. PR integrada por squash na `main` no commit `958963f1492def01c03020957a55f9e9cb7464f6`.

- **Gates da PR #497:** no HEAD `402ba4771f646026c82166df5643132268751e56`, Audit PASS run `39186398504` (incluindo `One-step merchant signup and referral attribution V1.410` PASS, browser mobile e E2E PASS), `Build isolated live portals` PASS run `39186398415`; release-candidate sem deploy SKIPPED. Não alegar PostgreSQL/visual smoke nesta PR pois os filtros não dispararam. A PR #492 não exibia execuções no `fetch_commit_workflow_runs` para seus SHAs recentes (filtro dessa ferramenta limitado a pull_request), portanto o release isolado forneceu CI comprovado.

- **Publicação:** após o merge, a última consulta antes deste checkpoint ainda mostrava atestado OIDC do SHA anterior `6a13bb29acf8`, não do novo `958963f`. Necessário confirmar que o workflow de publicação ateste `958963f` nos três portais (`tamao.com.br`, `parceiro.tamao.com.br`, `admin.tamao.com.br`) antes de afirmar que a nova interface entrou no ar. Ausência temporária não é falha nem sucesso.

- **Estado real preservado:** Supabase em `PRELAUNCH`, `commerce_enabled=false`; revenda existente `pending`/offline e com `price_confirmed_at=null`; ainda 1 inscrição, 0 pedidos, migração de expansão não aplicada. Nenhuma ativação automática, preço forjado ou compra/pagamento de teste.

- **Próxima tarefa prioritária:** conferir novo atestado SHA nos três portais, depois homologação real OTP de **duas contas distintas** e múltiplos CNPJs legítimos, verificação do vínculo pelo admin, proteção de leitura cruzada e retorno/edição. Só então oferta e pedido real com revenda apta/autorizações. Manter Profissionais/Caronas/Hospedagens/Ads/SEO isolados na PR #492 draft. Após squash #497 a branch canônica pode ficar mais commits atrás da `main` no histórico; preservar o ramo e reconciliar antes de merge futuro, sem criar estruturas paralelas.


## Reconciliação de publicação e aprovação direta — PR #497 (18/10/2026)

- **Publicação confirmada pelo atestador confiável:** o Supabase recebeu `platform_portal_attestations` em `2026-10-19T01:43:35Z`, fonte `github_oidc_edge`, com `source_sha=958963f1492def01c03020957a55f9e9cb7464f6` e `allPortalsReady=true`. Portais `customer`, `merchant`, `admin` apresentaram `htmlStatus=200`, `buildStatus=200`, `runtimeStatus=200`, `turnstileProduction=true` e mesmo SHA nas origens `https://tamao.com.br`, `https://parceiro.tamao.com.br`, `https://admin.tamao.com.br`. Isso comprova reconciliação automática de publicação, não E2E com contas reais.

- **Autoridade da aprovação checada no SQL real (somente leitura):** `public.admin_execute_action` chama `public.admin_approve_merchant_application` para `approve-application`; esta função exige `require_platform_admin`, bloqueia CNPJ com owner conflitante, cria revenda nova `pending`/offline (ou reaproveita revenda elegível), vincula o `applicant_user_id` como `owner`, provisiona `merchant_compliance` pendente e grava auditoria. O status `approved` da inscrição não libera vendas nem define compliance verificado. Isso é caminho administrativo real existente, não funcionalidade recém-implantada.

- **Pendências reais:** 1 revenda ainda `pending`/offline, preços gerais e comprovação regulatória pendentes, 1 inscrição e 0 pedidos. `PRELAUNCH`, comércio global e São Gabriel desligados. Testar envio OTP/cadastro por **duas identidades diferentes** e revisão administrativa real, confirmação operacional da revenda e pedido assistido com autorização antes de abrir. Nenhum cadastro artificial foi criado nesta sessão. Migração de expansão não aplicada.

- **Estado da execução:** correção multiempresa agora em produção via PR #497; PR #492 permanece única branch de expansão draft com divergência histórica após squash das PRs comerciais #496 e #497. Não mesclar a PR #492 até reconciliar `main` e concluir os gates próprios de anúncios/Storage/RLS/SEO/Ads.

## Home preço-primeiro — publicação oficial #498 (18/10/2026)

**Diretriz comercial prioritária:** o visitante deve encontrar imediatamente um **painel regional de cotações/preços**, diferenças reais entre revendas, como obter cashback/cupons elegíveis, motivos para usar o TAMÃO e valor de convidar compradores e revendas. A home não deve abrir prioritariamente com texto editorial longo.

**Entrega já integrada/publicada separadamente:** [PR #498](https://github.com/carloskk07/gassg/pull/498), squash em `main` `9f6c07684a3ac1eedf47635699466d41f266ee80`. Arquivos focados: `js/customer.js`, `js/home-showcase.js`, `css/components.css`, testes de preço regional, marketing e storytelling. O componente canônico `homeRegionalPriceBoard(homeRegion)` passou a aparecer **uma única vez, antes do hero editorial**, sem criar API nova. Benefícios na vitrine: comparação por CEP, Clube/cashback, cupons e campanhas quando válidos e indicações. Diferença só é exibida para duas ou mais revendas elegíveis com valores distintos, sem chamar isso de desconto garantido. Onde não há preço real, a referência P13 continua marcada como informativa/não oferta.

**Provas:** PR Audit PASS, build isolado dos 3 portais PASS, smoke visual PASS no SHA `89e027f10dc2ebb6db4e750934fa2b2ff4f91b72`. Em `main` `9f6c076`: [TAMÃO launch readiness PASS](https://github.com/carloskk07/gassg/actions/runs/39187730629), [Cloudflare official deploy PASS](https://github.com/carloskk07/gassg/actions/runs/39187730590), build PASS e atestado no Supabase `platform_portal_attestations` em `2026-10-19 01:58:56 UTC`. Leitura direta dos três manifests pelo agente web não conseguiu resolver os endereços; a prova existente é a verificação automatizada/OIDC do pipeline oficial.

**ATENÇÃO DE INTEGRAÇÃO:** esta PR #492 ainda altera `js/customer.js` e mantém cópia antiga de `js/home-showcase.js`/`css/components.css`. Antes de mesclar expansão, reconciliar cuidadosamente a `main` `9f6c076` e preservar o painel/preços PRIMEIRO, além dos recursos da expansão. Não sobrescrever ou duplicar a vitrine, nem fundir a PR #492 em produção sem seus gates completos. A confirmação operacional de revendas/pedidos reais continua na issue #493.


## Atualização das cotações sem recarregar — PR #499 (18/10/2026)

- A diretriz **home preço-primeiro** já havia sido efetivada e publicada pela PR #498 no commit `9f6c07684a3ac1eedf47635699466d41f266ee80`. Não reconstruir nem duplicar a vitrine de preços/benefícios.
- **Extensão cirúrgica entregue:** [PR #499](https://github.com/carloskk07/gassg/pull/499), integrada na `main` por squash `50aaf3b31235d532653de194e1990fd95f2d9503`. Alterados somente `js/home-showcase.js`, `js/acquisition.js`, `js/bootstrap.js` e `tests/customer-city-price-showcase-v1-341.mjs`.
- **Funcionalidade:** botão `↻ Atualizar cotações` somente com backend pronto, reutilizando a RPC existente `public_city_price_board_v1_341` (somente leitura, resposta real validada e delimitada pela cidade). Garante bloqueio de requisições simultâneas, mensagem de ausência de ofertas sem inventar preço, proteção contra troca de cidade durante a chamada e nenhuma mudança de CEP, endereço, carrinho ou pedido.
- **Prova na PR:** Audit PASS runs `39192415118` e `39192412358`; build dos três portais PASS `39192415091`. O contrato antigo de navegação foi preservado na correção de compatibilidade `c0c92b3`.
- **Publicação:** ao registrar a atualização, os workflows `TAMÃO launch readiness`, `Audit` e `Cloudflare official production deploy` da `main` `50aaf3b` estavam em execução. **Conferir conclusão e atestado do SHA nos três portais antes de declarar publicação concluída.**
- **Alerta de integração:** a PR #492 continua draft em ramo divergente historicamente após squashes comerciais. Antes de integrá-la na `main`, rebase/merge real com resolução dos arquivos do checkout e da home, mantendo os commits #498/#499, NÃO criar uma home alternativa e não sobrescrever `js/home-showcase.js` pela versão antiga da expansão. Preservar também o fluxo de inscrição multiempresa #497.
- **Limitação comercial honesta:** preços verificados de revendas só aparecem quando elegíveis. Como o comércio ainda não estava aberto na consulta anterior, valores de referência P13 permanecem **informativos** e não representam cotação final, cupom ativo ou entrega garantida.

### Publicação verificada no SHA 50aaf3b (18/10/2026 à noite, Brasil)

- A `main` `50aaf3b31235d532653de194e1990fd95f2d9503` concluiu `Build isolated live portals` PASS (run `39192586143`), `TAMÃO Cloudflare official production deploy` PASS (run `39192586238`) e `TAMÃO launch readiness` PASS (run `39192585918`). Reconciliação nativa também PASS (run `39192692904`).
- **Atestado OIDC Supabase confirmado:** `platform_portal_attestations.source_sha=50aaf3b31235d532653de194e1990fd95f2d9503`, `attestation_source=github_oidc_edge`, `verified_at=2026-10-19 03:01:15 UTC`, `run_id=39192585918`. O atestado corresponde à leitura autenticada feita pelo workflow oficial; não comprova por si só compras reais de clientes.
- **Estado comercial não alterado pela PR #499**: o botão apenas atualiza o painel de preços regional, sem integrar a expansão, alterar ofertas, ativar cidades ou cobrar.


## Incidente financeiro — PIX inválido na recarga de créditos (19/10/2026)

**Relato real:** usuário tentou comprar créditos e o banco acusou PIX inválido. Diagnóstico de produção, somente leitura: havia uma única solicitação `package_purchase`, plano `credit_300`, R$ 300, pendente desde `2026-10-15T17:44:52Z` e uma cobrança Mercado Pago correspondente com status `expired`, validade encerrada `2026-10-16T17:44:54Z`. No código armazenado o TLV do BR Code, moeda BRL, GUI Pix e CRC16 são válidos. Portanto **a cobrança conhecida está vencida**, não malformada; não foi comprovado ser ela a tentativa mais recente do usuário. Nenhum crédito consta confirmado por essa cobrança. Logs mostraram POSTs 401 para a função, mas podem ser probes de autenticação e não foram atribuídos a esse usuário.

**Correção de segurança e UX:** [PR #500](https://github.com/carloskk07/gassg/pull/500) integrada à `main` no SHA `425e7213b998863f7ea44e1ba7ac5286ef443ea3`, sem migrações ou pagamentos. Novo validador `supabase/functions/_shared/pix-brcode.js` confere formato EMV TLV, GUI, moeda/país, CRC16 e valor quando declarado. Edge `merchant-billing-pix` passa a rejeitar BR Codes inválidos antes de salvar ou retornar e recusa devolver código ativo vencido. O front-end impede copiar PIX vencido e evita afirmar sucesso se uma nova cobrança não vier ativa, com código e validade futura.

**Testes:** na PR, `Audit` PASS run `39195051837` e `Build isolated live portals` PASS run `39195051817`. O teste `tests/merchant-pix-brcode-validity.mjs` é executado pelo Audit e passou com carga sintética sem transação financeira, incluindo CRC inválido, valor divergente e bloqueio de cópia de código expirado. Antes da aprovação houve falha TS de tipagem; corrigida em `38f76b4`. O verificador novo também foi executado diretamente contra o BR Code real antigo: estrutura válida, status expirado (sem expor o payload).

**Publicação backend:** função Supabase `merchant-billing-pix` atualizada e confirmada ACTIVE v9, arquivos da `main` preservando `_shared/domain.js`, `_shared/mercadopago.js` e `_shared/provider-charge-cancel.js`; adicionada dependência `pix-brcode.js`; `verify_jwt=false` foi mantido deliberadamente porque a função já valida sessão internamente via `getUser`. Não há alteração de segredo ou credencial.

**Gates ainda abertos:** último atestado dos 3 portais consultado neste ponto ainda estava no SHA anterior `50aaf3b`, não no merge `425e7213`; verificar deploy/reconciliação OIDC do novo SHA antes de afirmar atualização do front-end. Não foi possível comprovar se o Access Token do Mercado Pago no ambiente é de teste ou produção (ambos podem usar prefixo `APP_USR`), nem fazer pagamento real. BR Code válido no formato não garante cobrança pagável: somente tentativa legítima em aplicativo bancário e confirmação do provedor demonstram isso. Não criar transação onerosa de teste. Caso um **PIX recém-gerado** continue rejeitado, analisar detalhe de erro do banco e configuração do provedor sem expor segredo.

**Comércio e expansão:** plataforma e São Gabriel continuam PRELAUNCH/comércio fechado, 0 pedidos reais na última leitura. PR #492 continua draft e sem migração da expansão. A correção financeira é independente e não habilita vendas, cupons, anúncios ou novas modalidades.


### Reconciliação pós-publicação do PIX (19/10/2026)

- **CONFIRMADO:** depois do merge da PR #500, a atestação OIDC em `platform_portal_attestations` às `2026-10-19T03:34:24Z` mostrou SHA `425e7213b998863f7ea44e1ba7ac5286ef443ea3` nos três domínios oficiais de customer, merchant e admin, cada um com `htmlStatus=200`, `buildStatus=200`, `runtimeStatus=200`, `turnstileProduction=true` e `allPortalsReady=true`. A função Edge `merchant-billing-pix` foi confirmada ACTIVE v9 com a dependência `_shared/pix-brcode.js` e a autenticação customizada preservada.
- **Após publicação:** apenas 1 cobrança histórica, 0 ativas, 0 concluídas; último registro continua em 15/10/2026 e expirou 16/10. Não foi emitido PIX oneroso de prova. A aceitação de um novo código pelo banco e a distinção credenciais teste/produção do Mercado Pago continuam **não verificadas**. Se banco rejeitar PIX recém-criado, conferir erro bancário/ordem no provedor, sem tratar CRC válido como garantia de pagamento.


## Central de testes financeiros do Admin — PR #501 (19/10/2026)

**Solicitação:** permitir que o superadmin execute todos os testes financeiros no painel Admin, sem autenticar como revenda. Separar testes sem transação, provedor sandbox e pagamentos reais conciliáveis. Não simular como recebido o que o PSP não confirmou.

**Implementação publicada:** [PR #501](https://github.com/carloskk07/gassg/pull/501), squash `ab550e6d25b80a76b7b9bf00f0f8e850003b949b` na `main`. A seção `Admin > Financeiro > Laboratório` aparece somente para superadmin; os outros papéis financeiros preservam suas 4 abas anteriores. Valor de R$ 0,01 a R$ 1.000.000,00 e cenários de PIX, fatura ilustrativa, vencimento, webhook e conciliação simulados somente no navegador, sem ledger nem documento fiscal. Há botões para teste de conectividade de PSP e áreas de cobrança/webhook e conciliação existentes.

**Teste com provedor:** ação `admin-ops:finance-lab-sandbox-pix` exige superadmin e três condições explícitas no servidor: `FINANCE_LAB_SANDBOX_ENABLED=true`, `MERCADOPAGO_TEST_ACCESS_TOKEN` separado do token de produção e `FINANCE_LAB_TEST_PAYER_EMAIL`. Sem estas configurações, falha fechada com `409` e mensagem útil. Quando habilitada, chama `/v1/orders` de teste do Mercado Pago com valor escolhido, chave idempotente, valida BR Code/valor/evidência sandbox, audita order ID sem registrar código completo; não altera `merchant_billing_payment_requests`, carteira, crédito ou faturas reais. Sandbox **não é PIX pagável em banco**.

**Gates:** Audit PASS run `39197076186` (incluindo `admin-financial-lab.mjs` e regressão das abas móveis V1.191), Build isolated live portals PASS run `39197076127`. Função `admin-ops` publicada e confirmada ACTIVE v174 com autenticação interna preservada e `verify_jwt=false`, sem alteração de dependências antigas; import adicional `_shared/pix-brcode.js`. OIDC `platform_portal_attestations` após merge registra SHA `ab550e6d25b80a76b7b9bf00f0f8e850003b949b`, `allPortalsReady=true`, customer/merchant/admin HTML/build/runtime 200 às `2026-10-19T04:00:04Z`.

**Condição incompleta:** não há prova de que credenciais sandbox separadas estejam configuradas; nenhuma ordem de teste PSP foi emitida nesta sessão. Faturas geradas no Laboratório são demonstrativas, não títulos emitidos ou cobrados. Para permitir cobrança real de valor livre pelo Admin (sem revenda) será necessário vínculo a um beneficiário/test case, idempotência, trilha contábil e reembolso/conciliação do PSP, com bloqueio de crédito automático e autorização explícita. Não transformar o sandbox em live sem esse gate.

**Estado comercial:** PRELAUNCH/comércio desabilitado e zero pedidos reais; expansão #492 não integrada. Próxima ação: homologar visualmente o Laboratório na conta real do superadmin, configurar apenas credenciais específicas de sandbox caso se deseje emitir ordens de teste e validar o retorno do provedor; seguir com comercial assistido conforme issue #493.


## Laboratório Financeiro — correção do sandbox oficial e consulta de status (19/10/2026)

**CONTINUIDADE:** retomada a partir de PR #501 em `main` (`ab550e6`), documentos de escopo e arquitetura consultados; PR #492 continua a única integração de descoberta/expansão e não deve absorver antecipadamente funções incompletas. Nenhum reset/duplicação da branch.

**Verificação externa:** documentação oficial Mercado Pago para Checkout API Orders PIX exige transação teste via `/v1/orders` com valores predefinidos (exemplo `50.00`) e `payer.first_name=APRO`, não um valor arbitrário; ordem em `processing_mode=automatic` não recebe `expiration_time`. Webhook de teste não prova recebimento de dinheiro em produção. A V1 anterior permitia qualquer valor no sandbox, contrariando o teste oficialmente documentado, embora o simulador interno arbitrário estivesse correto.

**PR #502:** [correção integrada](https://github.com/carloskk07/gassg/pull/502), `main` SHA `338fed65d2491dd0b4f1292dc697cb1fecbd271b`. A tela de fatura simulada permanece com valores livres, sem writes. Botão PIX de sandbox passa a indicar R$ 50,00 fixos e usa dados de teste do provedor. Backend rejeita valor divergente, credenciais idênticas ao token de produção, código BR/CRC ou prova sandbox ausente. As novas ações somente superadmin `finance-lab-readiness` (diagnóstico sem segredos/lista de ordens auditadas por usuário) e `finance-lab-sandbox-check` (GET do PSP com vínculo à própria auditoria, valor e referência) não creditam saldo nem geram cobranças reais. IDs provenientes do PSP foram restringidos a caracteres seguros antes de exibição em botões do Admin.

**CI do HEAD `6dcfeaabfaf28fee1944790f06ae0254bc0b6482`:** Audit PASS run `39198359976`, build 3 portais PASS run `39198360057`, revisão release candidate sem deploy SKIPPED. Primeiro Audit apontou regressão no mock assíncrono da V1.191, corrigida antes da aprovação. Checks específicos de `admin-financial-lab.mjs` e `admin-finance-workspace-v1-191.mjs` foram aprovados. Somente 5 arquivos de JS/TypeScript/teste; sem migrations, scripts monetários ou novos serviços.

**Backend implantado:** Supabase `lgugwujpunhslavewffd` Edge `admin-ops` ACTIVE versão 175, configuração `verify_jwt=false` mantida com autenticação real customizada já existente, sete dependências inalteradas. Consultas de verificação encontram zero ordens sandbox geradas, uma cobrança antiga registrada, zero pedidos, modo PRELAUNCH/comércio false. Nenhuma chave de teste foi configurada ou emitida durante a sessão.

**Atestado da publicação:** no início da verificação pós-merge, `platform_portal_attestations` ainda apontava SHA anterior `ab550e6`; verificar que os três portais registrem `338fed6` via OIDC antes de declarar frontend novo publicado. Não interpretar HEAD em GitHub como prova de HTTP em produção.

**GATES PENDENTES:** a ação de criação sandbox só funciona depois de configuradas explicitamente `FINANCE_LAB_SANDBOX_ENABLED=true`, `MERCADOPAGO_TEST_ACCESS_TOKEN` e `FINANCE_LAB_TEST_PAYER_EMAIL`, não verificadas. Sem conta de administrador real nesta sessão, não houve teste autenticado de status ou geração de order oficial. Emissão de PIX bancário pagável por valor arbitrário e fatura real vinculada exigirão destino identificável, reembolso/conciliação, idempotência e trilha contábil própria, mantendo crédito automático desabilitado para testes. Não marcar como implementados.

**PRÓXIMO PASSO:** verificar atestado OIDC da `main`; usar Admin > Financeiro > Laboratório para verificar prontidão e realizar teste sandbox oficial somente após configurar credenciais próprias de TESTE; conferir GET da ordem, status e auditoria, sem alterar livro financeiro; preparar fluxo documentado de faturas reais controladas em nova etapa sem impor custo/ativação.


**Reconciliação HTTP comprovada da #502:** atestado OIDC `2026-10-19T04:16:28Z` registrou SHA `338fed65d2491dd0b4f1292dc697cb1fecbd271b`, `allPortalsReady=true`, origem customer/merchant/admin com `htmlStatus=200`, `buildStatus=200`, `runtimeStatus=200` e Turnstile de produção. O atestado de rede é evidência de publicação, não um teste autenticado do sandbox real.


## Laboratório financeiro — ajuste oficial PIX/consulta PSP, PR #503 (19/10/2026)

**Entrega segregada da expansão:** PR [#503](https://github.com/carloskk07/gassg/pull/503), branch comercial `fix/admin-financial-lab-status-502`, integrada via squash na `main` no SHA `265ebc9e8a6f33676477cc0d674f56bf99f39742`. Arquivos: `js/admin.js`, `js/bootstrap.js`, `supabase/functions/admin-ops/index.ts`, testes `admin-financial-lab.mjs`, `admin-finance-workspace-v1-191.mjs`. NÃO inclui migração de anúncios nem módulos de Profissionais/Caronas/Hospedagens.

**Correção do contrato real de homologação PIX:** a documentação pública oficial do Mercado Pago Checkout API Orders prescreve ordem de PIX de TESTE com `total_amount=50.00`, pagamento PIX de `50.00` e `payer.first_name=APRO`; o retorno esperado inicia `action_required` e passa a aprovado. A ação `finance-lab-sandbox-pix` agora aceita somente **5000 centavos**, exige credenciais próprias de testes separadas do token de produção, bloqueia valores divergentes, confirma ambiente sandbox, valor e BR Code (CRC/TLV) e não grava qualquer saldo, crédito ou fatura real. A simulação demonstrativa de fatura no Admin permanece com valores livres.

**Leitura de testes:** ações `finance-lab-readiness` e `finance-lab-sandbox-check` disponíveis exclusivamente ao superadmin. A primeira apresenta apenas flags sanitizadas de credenciais e até 12 ordens de sandbox associadas ao próprio administrador pelo `platform_admin_audit`. A segunda consulta o PSP pelo ID de ordem auditado e revalida `external_reference`, ID, valor de 5000 centavos e evidência do ambiente sandbox; devolve estado de ordem/pagamento sem alterar a carteira (`credited=false`). Botões vinculados em Admin > Financeiro > Laboratório.

**CI:** no HEAD de PR `6dcfeaabfaf28fee1944790f06ae0254bc0b6482`, Audit PASS run `39199576478` (inclui laboratório financeiro e navegação dos demais perfis), build isolado dos 3 portais PASS run `39199576415`. PR foi considerada mergeable com exatamente 5 arquivos no diff, e integrada com commit `265ebc9e`. Release candidate de revisão visual sem deploy SKIPPED pelo workflow (não tratar como aprovação).

**Implantação comprovada:** Supabase `admin-ops` ACTIVE v176, `verify_jwt=false` preservado porque a função valida bearer via `getUser` e papel via `platform_admins`; shared dependencies conferidas idênticas às instaladas antes da publicação. Os dados e a abertura comercial permanecem inalterados (`PRELAUNCH`, `commerce_enabled=false`). Na última verificação, atestado OIDC dos 3 portais ainda apontava commit anterior `338fed65`, não `265ebc9e`. **NÃO declarar frontend da nova revisão publicado sem SHA concordante.**

**Gates pendentes:** somente o superadmin autenticado pode comprovar readiness e efetuar teste oficial de ambiente sandbox; não foram verificadas credenciais de teste instaladas nem criada ordem no provedor. O teste oficial não produz PIX pagável em banco. Fluxo futuro de cobranças de valores arbitrários e pagamento real pelo Admin exige registro financeiro auditável, autorização explícita e conciliação do PSP; não reclassificar simulação como recebimento. Validar OIDC SHA `265ebc9e` nos três portais, então testar UI em conta real e registrar falhas. Continuar a expansão na PR #492 sem transportar experimentalizações.


### Reconciliação de publicação da PR #503 — confirmação posterior

**EVIDÊNCIA CONFIRMADA APÓS O CHECKPOINT:** o atestador de infraestrutura `github_oidc_edge` gravou em `platform_portal_attestations` às `2026-10-19T04:31:48Z` o SHA `265ebc9e8a6f33676477cc0d674f56bf99f39742`, `allPortalsReady=true`. Customer `https://tamao.com.br`, merchant `https://parceiro.tamao.com.br` e admin `https://admin.tamao.com.br` retornaram `htmlStatus=200`, `buildStatus=200`, `runtimeStatus=200`, `turnstileProduction=true` e `sourceSha` idêntico. A tabela `platform_launch_control` também aponta `portals_source_sha=265ebc9e`, mas preserva `PRELAUNCH` e `commerce_enabled=false`. Esta evidência substitui a pendência de SHA da publicação nos parágrafos anteriores, **não** substitui o teste de login e PIX externo com credenciais de sandbox, nem autoriza cobranças reais.


## Laboratório Financeiro — idempotência e reconciliação oficial da PR #504 (19/10/2026)

**Problema real de resiliência:** a leitura de uma ordem sandbox consultava `platform_admin_audit` com `.maybeSingle()` sem limite. Duas escritas de auditoria iguais após repetição da solicitação idempotente poderiam fazê-la falhar por cardinalidade, embora a ordem pertença ao administrador. Corrigido sem exclusão ou alteração de evidências: filtragem por `actor_user_id`, `action`, `target_id`, ordenação decrescente em `created_at` e `.limit(1).maybeSingle()`. Mantidas verificações de referência, valor, status de ambiente sandbox, ID e `credited=false`.

**Entrega:** [PR #504](https://github.com/carloskk07/gassg/pull/504) com 2 arquivos alterados (`supabase/functions/admin-ops/index.ts`, `tests/admin-financial-lab.mjs`), integrada via squash à `main` no SHA `fda73b4bb11f2907283a35021d907d1291cdefb8`; Audit PASS run `39200286343`, incluindo o teste Admin Lab, sem migrações ou créditos. Build isolado não disparou nessa PR estreita; o último build dos três portais já havia passado na PR #503 (run `39199576415`).

**Implantação:** Supabase `admin-ops` ACTIVE v177, `verify_jwt=false` preservado com verificação interna de sessão/perfil, dependências já instaladas comparadas sem divergência; versão publicada inclui `.order("created_at",{ascending:false}).limit(1).maybeSingle()`. Atestado OIDC posterior ao merge, `2026-10-19T04:39:31Z`, registrou SHA `fda73b4bb11f2907283a35021d907d1291cdefb8`, `allPortalsReady=true`, nos 3 domínios oficiais; HTML, build e runtime 200 e Turnstile de produção presentes.

**Pendente:** login real do superadmin e teste com credenciais sandbox separadas ainda não executados; nenhuma ordem PIX externa de teste ou pagamento foi criada nesta sessão. Valor livre no Admin gera documento demonstrativo, não fatura pagável; emissão de cobrança real arbitrária requer vínculo financeiro, autorização explícita, conciliação e cancelamento/reembolso. Plataforma segue `PRELAUNCH`/comércio desabilitado, 0 pedidos. A expansão da PR #492 continua isolada. Próxima continuação deve começar verificando este checkpoint e os SHAs, e não duplicar a implementação.


## Laboratório financeiro — Diagnóstico de PIX históricos #505 (19/10/2026)

**Nova entrega isolada do Admin:** PR [#505](https://github.com/carloskk07/gassg/pull/505) concluída e integrada por squash à `main` SHA `db1986b44c60cd7e2781c951601a7d0550630edc`, sem transportar a expansão da PR #492. Novo botão `Admin > Financeiro > Laboratório > Diagnosticar cobranças PIX`, acessível apenas ao superadmin. Usa API `admin-ops:finance-lab-charge-diagnostics` em modo leitura: últimas 20 cobranças PSP, comparando BR Code, CRC/valor, data de vencimento, status da solicitação, divergência do valor e último erro armazenado. Resposta **não contém BR Code, chave PIX, QR, identificação da revenda, token ou dados de recebedor**. Nenhum pagamento é criado ou alterado. BR Code bem formado NÃO comprova aceitação bancária ou PSP.

**Gates dessa revisão:** Audit PASS run `39226739730` incluindo teste isolado `tests/admin-financial-pix-diagnostics.mjs` de código válido mas vencido, CRC inválido, valor divergente, proteção do superadmin e ausência de payload PIX; build isolado dos 3 portais PASS `39226739795`. Release candidate no-deploy SKIPPED; nenhuma migration nova.

**Backend publicado:** `admin-ops` ACTIVE v178 no projeto Supabase `lgugwujpunhslavewffd`, com rota nova presente e `verify_jwt=false` preservado (autenticação própria `getUser`), dependências existentes comparadas e intactas. Em produção ainda há 1 cobrança histórica e 0 pedidos; plataforma `PRELAUNCH`, `commerce_enabled=false`. O diagnóstico não gera gastos nem saldos.

**Evidência de portais:** na primeira leitura pós-merge o atestado OIDC ainda mostrava SHA `fda73b4bb11f2907283a35021d907d1291cdefb8` (anterior), não `db1986b4`. A atualização da interface depende de nova reconciliação dos três portais; consultar novamente antes de declarar publicada na web. Não confundir Edge ACTIVE com deploy confirmado do frontend.

**Pendências:** teste autenticado do botão no Admin real, configuração autorizada do token de sandbox e simulação oficial de R$ 50,00, inspeção de recusa real de novo PIX no aplicativo bancário e emissão de fatura pagável/valor livre com conciliação legal/financeira. A expansão #492 segue draft e isolada; não alterar a revenda/cidade para esta melhoria.


### Reconciliação final de publicação do diagnóstico PIX #505

**ATUALIZAÇÃO VALIDADA:** Supabase recebeu atestado `github_oidc_edge` em `2026-10-19T09:02:47Z`, `source_sha=db1986b44c60cd7e2781c951601a7d0550630edc`, `allPortalsReady=true`. Portais `tamao.com.br`, `parceiro.tamao.com.br` e `admin.tamao.com.br` registraram `htmlStatus=200`, `buildStatus=200`, `runtimeStatus=200`, `turnstileProduction=true` e SHA coincidente. Assim o bloqueio de reconciliação frontend do checkpoint anterior está resolvido. Isso **não** equivale à autenticação real do superadmin nem prova novo PIX bancariamente pagável.


## Laboratório financeiro — evidências de webhook e conciliação #506 (19/10/2026)

**Retomada sem repetição:** a PR #503 (Pix oficial sandbox de R$ 50,00 e verificação de status), #504 e #505 (diagnóstico de cobranças Pix) já estavam integradas quando a execução foi retomada. A expansão #492 segue em draft e não foi transportada a produção.

**Correção incremental na PR [#506](https://github.com/carloskk07/gassg/pull/506):** integrada por squash à `main` no commit `1018b5f60cb3284491736de135f5f1d36605c13f`. Apenas `supabase/functions/admin-ops/index.ts`, `js/admin.js` e `tests/admin-financial-pix-diagnostics.mjs`. A ação `finance-lab-charge-diagnostics` passou a correlacionar últimas 20 cobranças com até 100 eventos da tabela real `merchant_billing_payment_events`, somente leitura, por `payment_request_id` e `provider`. Devolve por cobrança quantidade de eventos recebidos, aplicados, ignorados e pendentes, com último recebimento e sinais de divergência de valor. No Admin fica claro que webhook recebido não significa recebimento confirmado; não retorna BR Code, chave Pix, dados do pagador nem IDs de evento. Não invoca pagamentos externos, webhooks ou alteração de saldo.

**Gates comprovados:** Audit PASS [39241471041](https://github.com/carloskk07/gassg/actions/runs/39241471041), incluindo regressão `tests/admin-financial-pix-diagnostics.mjs` com isolamento entre PSPs, código expirado, webhook ignorado/aplicado e proibição de dados sensíveis; Build isolated live portals PASS [39241471233](https://github.com/carloskk07/gassg/actions/runs/39241471233), release candidate no-deploy SKIPPED. Primeiro Audit acusou asserção de texto antigo, corrigida antes do merge. A PR #506 não possui migração SQL.

**Publicação:** Supabase `admin-ops` ACTIVE v179, `verify_jwt=false` preservado porque a função mantém autenticação própria, 7 dependências compartilhadas byte-idênticas à versão anterior. Atestação OIDC dos portais em `2026-10-19T11:03:33Z`, `source_sha=1018b5f60cb3284491736de135f5f1d36605c13f`, `allPortalsReady=true`; HTML/build/runtime HTTP 200 e Turnstile produção em customer, merchant e admin. `platform_launch_control.portals_source_sha` corresponde ao SHA.

**Dados reais:** banco mantém 1 cobrança de provedor histórica (expirada anteriormente), **0 eventos de pagamento recebidos**, **0 eventos aplicados** e **0 pedidos**. `PRELAUNCH` e `commerce_enabled=false` permanecem. Nenhum crédito, PIX ou fatura foram gerados nesta execução.

**O que ainda falta:** executar a jornada dentro de uma sessão real do superadmin; credenciais específicas de TESTE do Mercado Pago para validar criação/consulta de pedido oficial sandbox; pagamento PIX bancário realmente válido, solicitação/recebimento PSP e reconciliação sob autorização explícita. Valor arbitrário no Admin continua simulado e não pagável; o modo oficial de testes do Mercado Pago usa R$ 50,00. A integração comercial assistida e abertura segura continuam prioridade da issue #493. Não declarar TAMÃO integral pronto nem confluir com expansão #492.
