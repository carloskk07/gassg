# TAMÃO — conciliação de origem das funções SQL históricas

Fotografia de **17/10/2026**, referente à `main` `7307b0fda2620b55072c5e0b90d18d781da66892`. Esta análise é **somente leitura**: não altera funções, privilégios, revendas, pedidos, saldos nem controle comercial.

## Evidência do Supabase de produção

Executei a consulta [`scripts/audit-legacy-sql-provenance-v1-399.sql`](../scripts/audit-legacy-sql-provenance-v1-399.sql) diretamente no projeto conectado. Resultado:

| PR histórica | Versão da migration ausente do Git | Registrada em `schema_migrations`? | Função representativa hoje | Existe? | EXECUTE de anon / authenticated / service_role |
|---|---|---|---|---|---|
| [#38](https://github.com/carloskk07/gassg/pull/38) | `20261003060000` | Não | `admin_assisted_merchant_onboarding_v2` (candidata a substituta) | Sim; `admin_approve_pilot_application` antiga não existe | Não / Não / Sim |
| [#82](https://github.com/carloskk07/gassg/pull/82) | `20261005120500` | Não | `merchant_allowed_in_operation_mode` | Sim | Não / Não / Sim |
| [#205](https://github.com/carloskk07/gassg/pull/205) | `20261011043000` | Não | `merchant_delivery_payment_allowed` | Sim | Não / Não / Sim |
| [#207](https://github.com/carloskk07/gassg/pull/207) | `20261011063000` | Não | `merchant_basket_compliance_current` | Sim | Não / Não / Sim |
| [#208](https://github.com/carloskk07/gassg/pull/208) | `20261011073000` | Não | `merchant_settlement_daily_due_at` | Sim | Não / Não / Sim |
| [#209](https://github.com/carloskk07/gassg/pull/209) | `20261011083000` | Não | `admin_merchant_representation_action` | Sim | Não / Não / Sim |

As seis migrations originais **não constavam na `main`** ao fazer esta auditoria. Todos os seis identificadores também estavam ausentes do registro `supabase_migrations.schema_migrations`. Isso **não prova** que o efeito dessas migrations esteja ausente, pois funções atuais existem; pode ter havido aplicação manual ou implementação posterior, cujos detalhes ainda exigem prova.

A consulta de autorização verifica somente as **funções representativas listadas**. Não é uma auditoria integral de RLS, dos gatilhos, de outras sobrecargas de função, das dependências, de todas as ACLs nem dos efeitos do fluxo. O fato de uma função existir **não comprova que seu corpo seja equivalente à PR antiga**. Da mesma forma, `EXECUTE` restrito a `service_role` não dispensa a validação interna do usuário, papel, sessão e contexto comercial.

## Por que essas seis PRs permanecem abertas

- **#38:** há uma autoridade de onboarding assistido V2, mas a antiga ação de aprovação vinculada ao staging não existe com aquele nome. É preciso comprovar a equivalência do fluxo comercial, não copiá-lo cegamente.
- **#82:** a função de filtragem por modo operacional existe, porém resta comparar a proteção de *resgate* de pedidos sob concorrência com o corpo SQL atual.
- **#205:** a elegibilidade de pagamento na entrega está modelada no banco, mas deve ser conferida em cotação, checkout e criação do pedido.
- **#207:** a cesta com GLP precisa de prova de conformidade ANP sem bloquear produtos comuns; função representativa existente não substitui testes integrados.
- **#208:** a autoridade de vencimento D+1 existe, mas falta comparar integridade das janelas, datas e reprocessamento com a proposta antiga.
- **#209:** a função de representação empresarial existe, mas é necessário validar revisão, revogação, idempotência e efeitos sobre elegibilidade.

## Regras para concluir

1. Conferir a versão **realmente ativa** de cada função/gatilho, grants e políticas, comparando com os requisitos de negócio e testes atuais.
2. Buscar a origem canônica da DDL aplicada e reconciliar o histórico **sem mentir ao registro de migrações**. A ausência de `schema_migrations` não autoriza simplesmente inserir linhas fictícias.
3. **Não executar nem reaplicar** as migrations antigas das PRs. Algumas incluem `CREATE OR REPLACE`, DDL de tabelas, grants e validações que poderiam substituir proteções mais recentes.
4. Só aprovar uma recuperação cirúrgica depois de testes de regressão, permissões, concorrência e reconciliação de implantação.
5. Fechar as seis PRs antigas apenas com comentário apontando evidências verificáveis da implementação que as substituiu ou da correção já integrada.

## Para uma nova revisão

Reexecute a consulta SQL guardada e registre a data, a SHA da `main`, a versão real das Edge Functions e o resultado dos testes. Esse arquivo documenta **um diagnóstico datado**, não um monitoramento permanente nem uma autorização de migração.

## Atualização V1.400 — origem canônica comprovada em 17/10/2026

A tabela inicial registra corretamente a **ausência dos números históricos das branches**. Uma verificação adicional provou que quatro migrations foram integradas sob IDs posteriores. Essa descoberta esclarece a ausência dos números anteriores, sem exigir reparação artificial do histórico.

| PR original | ID da migration na PR | Migration canônica na `main` | Presente no histórico aplicado? |
|---|---|---|---|
| [#205](https://github.com/carloskk07/gassg/pull/205) | `20261011043000` | `20261012042111_delivery_first_payment_boundary_v1_158_1.sql` | **Sim** |
| [#207](https://github.com/carloskk07/gassg/pull/207) | `20261011063000` | `20261012042134_merchant_basket_compliance_v1_158_2.sql` | **Sim** |
| [#208](https://github.com/carloskk07/gassg/pull/208) | `20261011073000` | `20261012042157_settlement_daily_due_alignment_v1_158_3.sql` | **Sim** |
| [#209](https://github.com/carloskk07/gassg/pull/209) | `20261011083000` | `20261012042201_merchant_representation_authority_v1_158_4.sql` | **Sim** |

Comparei cada migration original diretamente com seu arquivo canônico. O conteúdo é **idêntico, exceto pela quebra de linha final** acrescentada aos arquivos da `main`. O banco confirmou `canonical_migration_registered=true` nas quatro correspondências. As funções e triggers críticos de proteção de pagamento, conformidade e D+1 também foram identificados no banco com consulta **somente leitura**. Essa prova resolve a origem do SQL, mas não substitui testes ponta a ponta de transações reais.

`tests/legacy-canonical-sql-v1-400.mjs` verifica os **Git blob SHA-1** desses quatro arquivos já registrados, impedindo reescrever migrations aplicadas sem criar uma versão nova. O controle não depende da existência futura das branches históricas.

### PR #82 — resgate de pedidos durante o modo PILOT

A função efetiva `merchant_allowed_in_operation_mode` foi comparada ao corpo da PR #82 (normalizando somente sintaxe/whitespace de DDL): a condição de elegibilidade do modo PILOT é equivalente. Também conferi o corpo ativo de `system_rescue_order`: ainda contém filtragem por modo operacional **na busca inicial e na rechecagem sob lock**, bloqueio `FOR UPDATE SKIP LOCKED`, `pg_advisory_xact_lock` e confirmação integral dos itens. O SQL ativo também inclui `merchant_basket_compliance_current`, proteção posterior sobre GLP/ANP ausente na implementação histórica. `market_supply_status` preserva o filtro PILOT e evoluiu para conformidade por item. Todas as três funções estão restritas a `service_role`, sem execução direta por `anon` ou `authenticated`.

O teste V1.400 protege os fragmentos decisivos na origem versionada; **não** executa um resgate real nem simula concorrência no banco.

### PR #38 — ativação assistida permanece em revisão

A função antiga `admin_approve_pilot_application` não está implantada. Há `admin_assisted_merchant_onboarding_v2`, mas o contrato de seleção de staging, aprovações, inativação de catálogo e autorização comercial **ainda não foi comprovado como equivalente**. Não aplicar sua migration antiga. Manter em revisão enquanto a nova jornada é comparada ponta a ponta.

**Nota histórica:** as afirmações anteriores de "seis pendências" descrevem a fotografia V1.399 anterior à verificação de versões canônicas. Este adendo registra a descoberta posterior, sem apagar a evidência original.
