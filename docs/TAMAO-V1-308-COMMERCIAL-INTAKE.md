# TAMÃO V1.308 — Recebimento de propostas com controle do administrador principal

## Objetivo
Permitir que o administrador principal abra ou suspenda **novas propostas comerciais das revendas** sem alterar código.

Duas chaves realmente executadas no PostgreSQL:
- `ads_proposals`: controla novo interesse comercial e `save`/`submit` de peças Ads; `view` e `withdraw` permanecem acessíveis.
- `clube_proposals`: controla novos registros de interesse das revendas; `view` e `withdraw` permanecem acessíveis. Documentos de negociações existentes continuam passíveis de revisão.

## Proteções
- Tabela dedicada com RLS e sem `GRANT` de leitura/gravação para `anon` e `authenticated`.
- RPCs `service_role` para consulta e alteração. A leitura exige perfil ativo superadmin/operations/readonly; a escrita exige **superadmin ativo** no próprio PostgreSQL.
- Verificação de versão anterior (`expectedVersion`), transação e lock `FOR UPDATE`, motivo de 8 a 240 caracteres e trilha `platform_admin_audit`.
- Identidade `p_actor` é derivada exclusivamente do JWT verificado pela função Edge.
- Mudanças idempotentes não incrementam a versão nem repetem auditoria; versões divergentes geram conflito.
- Se a chave não existir, sua ausência é interpretada como **bloqueio de novas entradas**.
- A migração cadastra as duas entradas como **habilitadas** para preservar o fluxo atual; isso **não** ativa campanhas ou cupons.
- A proibição de novas propostas é aplicada nas RPCs oficiais (camada PostgreSQL), não apenas no JavaScript. Retirada e leitura nunca são bloqueadas pela pausa.

## Não abrangido nesta versão
Não libera publicidade para visitantes, impressões patrocinadas, cobrança Ads, contratos, venda/resgate de cupons, créditos, comissões, envios push ou comércio em cidades. Essas ações precisam de seus próprios fluxos de prova econômica, conformidade e execução.

## Instalação e validação
A migração `20261016020000_marketing_intake_control_v1_308.sql` deve ser aplicada antes de publicar o novo `admin-ops`. A versão Edge deve preservar `verify_jwt=false` porque a função valida o JWT manualmente com `auth.getUser`.
O teste `node tests/admin-marketing-intake-v1-308.mjs` entra na auditoria do repositório. Conferir RLS, grants e estados com SQL após a migração e comprovar que nenhuma chave foi alterada comercialmente pelo deploy.
