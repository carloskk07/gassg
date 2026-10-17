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
