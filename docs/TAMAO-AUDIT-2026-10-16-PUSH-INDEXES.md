# TAMÃO — Auditoria de desempenho do subsistema push (2026-10-16)

## Evidência e escopo
O Supabase Performance Advisor identificou 38 relações com FK sem índice de cobertura. O subsistema push (outbox, subscriptions, deliveries e test runs) responde por seis dessas ocorrências. Antes desta atualização, a amostragem em produção encontrava 1 inscrição e nenhum item de outbox ou entrega; isto reduz o risco imediato, mas a ausência de índices pode amplificar leituras de integridade referencial e joins com o crescimento.

## Correção
Migração `20261016230500_push_fk_index_hygiene_audit.sql` cria seis índices simples sobre as colunas de FK do fluxo push, mantendo os índices existentes, sem alterar dados, permissões, políticas RLS, gatilhos ou autorizações. Os comandos são idempotentes e executados com limites de espera e duração. A alteração não ativa disparos nem modifica alertas que o Chrome possa classificar como spam.

## Verificação
- CI: `node tests/push-fk-index-hygiene.mjs`.
- Banco: conferir índices em `pg_indexes` e rerodar o Supabase Performance Advisor.
- Resultado esperado: reduzir de 38 para 32 avisos `unindexed_foreign_keys`, sem concluir que os 32 restantes sejam falhas críticas. Fazer medição antes de novos índices.
- Não alterar abertura comercial de São Gabriel, rotas de pagamento ou estados de pedidos.

## Riscos operacionais fora do escopo
A operação permanece em PRELAUNCH. A comprovação completa exige pedido real, aceite, entrega, conciliação financeira e recebimento da notificação no aparelho, depois da autorização administrativa e das verificações aplicáveis.
