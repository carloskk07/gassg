# TAMÃO V1.401 — autoridade segura para aprovação de parceiro piloto

## Incidente prevenido

A análise da [PR histórica #38](https://github.com/carloskk07/gassg/pull/38) identificou uma lacuna em `public.admin_approve_merchant_application(uuid,uuid)`, cuja definição ativa correspondia ao SQL de `20261004185000_pilot_partner_invite_v1_69.sql`.

Ao aprovar uma solicitação com `pilot_partner_draft_id`, a função podia encontrar uma revenda já ativa pelo mesmo CNPJ e **regravar o SKU** do draft com `active=false` e `available_stock=0`. A função executa a aprovação com autoridade de serviço, e não havia trigger adicional de catálogo para barrar a desativação.

## Guardas mínimos

A migração [`20261017222119_pilot_staging_approval_conflict_guards_v1_401.sql`](../supabase/migrations/20261017222119_pilot_staging_approval_conflict_guards_v1_401.sql) conserva toda a lógica original, adicionando somente:

1. Se a solicitação referencia um draft piloto, o merchant alvo deve estar **pending e offline**. Caso contrário, a função interrompe a transação com `PILOT_MERCHANT_NOT_PENDING` antes de tocar nos membros, catálogo ou staging.
2. Para o SKU proposto, a cláusula atômica `ON CONFLICT DO UPDATE WHERE` só permite atualizar linha existente se **inativa e com estoque zero**. Qualquer estado diferente não atualiza nenhuma linha, ativa `NOT FOUND` e provoca `PILOT_CATALOG_CONFLICT`. Esse predicado é verificado pelo PostgreSQL **no momento do conflito**, incluindo disputas por uma inserção concorrente. Toda a transação falha fechada e é revertida.

A aprovação **sem draft piloto** continua com o comportamento anterior. Nenhuma migração antiga foi reaplicada. As permissões `EXECUTE` continuam restritas a `service_role`; a Edge requer sessão administrativa verificada.

## Verificação

- O teste `tests/pilot-staging-approval-safety-v1-401.mjs` compara o corpo resultante **exatamente** ao original com os dois blocos de proteção, e verifica estados de revenda ativa/offline e SKU ativo/com estoque, além do mapeamento de erros.
- O workflow `Audit` executa o teste junto com as demais verificações e os testes móveis.
- A migration foi aplicada no Supabase por uma operação de migração transacional em **17/10/2026**, com versão **`20261017222119`** registrada em `supabase_migrations.schema_migrations`.
- A consulta pós-implantação confirmou ambos os códigos de conflito e o predicado `WHERE`, com `anon EXECUTE=false`, `authenticated EXECUTE=false`, `service_role EXECUTE=true`.
- **Não** foi simulado um conflito real concorrente entre duas sessões no banco de produção e **nenhum pedido, estoque, aprovação ou transação comercial** foi criado como teste.

## Pendência diferente da PR #38

O caminho antigo de **seleção manual de staging na aprovação** não foi recuperado. O fluxo atual utiliza convite/reivindicação associado à solicitação empresarial, e a V1.401 apenas impede efeitos destrutivos na aprovação. A PR #38 deve permanecer aberta até a experiência de vinculação para o administrador ser avaliada sem comprometer segurança.
