# TAMÃO — Diário Oficial de Execução Técnica

**Iniciativa:** TAMÃO — Expansão Integrada e Consolidação para Produção  
**Última atualização:** 2026-10-18  
**Repositório:** `carloskk07/gassg`  
**Branch de integração:** `feat/unified-discovery-tamao`  
**Branch oficial:** `main`  
**Commit-base de `main`:** `433101839489f7739f44ddcf04e664ddff3435bd`  
**SHA da última revisão com auditoria completa aprovada:** `7fbf28217d3e20e20a29368ef6e89046b6db759c`
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

**ÚLTIMA ETAPA CONCLUÍDA:** compensação de upload incompleto de comprovantes e fotos, proteção RLS contra remoção de fotos referenciadas e regressões de falhas de rede; quatro gates oficiais PASS no código `7fbf28217d3e20e20a29368ef6e89046b6db759c`. Nova edição documental requer nova conferência.

**ETAPA ATUAL:** validação real de Auth/Storage isolados, retenção/expurgo, reconciliação de objetos órfãos e E2E com anunciantes A/B, superadmin e visitante; infraestrutura de homologação independente não existe atualmente.

**PRÓXIMA AÇÃO EXATA:** confirmar CI do HEAD; utilizar homologação independente autorizada/isolada para verificar bytes reais, contas A/B/admin/visitante, signed URLs, perda de rede e moderação; depois fechar expurgo/reconciliação e E2E de criação → revisão → publicação → pausa, antes de qualquer merge.

**ARQUIVOS QUE DEVEM SER INSPECIONADOS:** `supabase/migrations/20261018131000_discovery_shared_verticals.sql`, `js/discovery-owner.js`, `js/admin.js`, `js/discovery.js`, `js/bootstrap.js`, `js/customer.js`, `scripts/build-live-portals.mjs`, `tests/discovery-owner-journey.mjs`, `tests/discovery-admin-journey.mjs`, `tests/discovery-db-integration.sql`, `docs/TAMAO_ESCOPO.md`.

**TESTES QUE DEVEM SER EXECUTADOS:** `node tests/discovery-owner-journey.mjs`, `node tests/discovery-admin-journey.mjs`, `node tests/discovery-public-journeys.mjs`, `node tests/discovery-shared-verticals.mjs`, `node tests/portal-performance-budget.mjs`, workflows `Audit`, `Build isolated live portals`, `TAMÃO discovery PostgreSQL contract` e `TAMÃO public visual smoke`; depois E2E Auth/Storage com usuários reais de homologação.

**BLOQUEIOS CONHECIDOS:** Migração e anúncios não existem em produção; Auth/Storage multiusuário real, verificação de arquivos binários, políticas de retenção/remoção, validação legal por modalidade, Cobrança Impulso, reputação, SEO argentino, regressões e E2E completos permanecem pendentes. Leitura HTTP direta dos três manifests não foi possível; apenas atestado de SHA no Supabase.

**CONDIÇÃO DE CONCLUSÃO:** Para cada vertical, cadastro, autorização, publicação, busca, contato e operação testados; para release, zero P0/P1 conhecidos, recuperação comprovada, migrações e portais reconciliados por SHA e autorização comercial do superadmin.

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
