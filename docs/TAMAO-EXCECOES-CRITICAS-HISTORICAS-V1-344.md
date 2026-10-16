# TAMÃO V1.344 — Visibilidade histórica das exceções financeiras críticas

Data: 16 de outubro de 2026. Portal: Admin → Aquisição / Financiamento.

## Falha de visibilidade

As filas ativas V1.338/V1.340/V1.341 deliberadamente excluem declarações anuladas e aquelas cuja última revisão foi encerrada administrativamente. Isso atende ao fluxo de trabalho, mas pode ocultar da **visão consolidada** situações em que um pedido foi revertido **depois de existir observação histórica positiva do PSP**. Um encerramento administrativo não é prova de liquidação bancária, nem remove a observação registrada anteriormente.

## Correção V1.344

Criada visão separada **Exceções críticas com histórico preservado**, sem reabrir a fila ativa, alterar o diário ou produzir novas obrigações. Ela reúne, entre todas as competências, declarações que cumprem simultaneamente:

- concessão do pedido com `reversed_at` registrado;
- ao menos uma observação histórica `provider_transaction_success=true` do provedor associada à declaração;
- declaração anulada **ou** última revisão `closed_administrative`.

O relatório separa os totais de encerrados sem anulação e anulados, mostra a soma nominal dos valores **declarados** (não comprovados), o pedido, declaração, mês, data de reversão e o histórico de revisão V1.337. Usa páginas de 30, com ordem determinística: encerrados não anulados primeiro, depois anulados, dentro de cada classe reversão mais recente primeiro. A paginação evita perder casos fora das primeiras 30 posições.

A fila ativa e o acompanhamento de prazos permanecem inalterados. O caso histórico continua disponível para auditoria e leitura mesmo que deixe de ser uma pendência operacional. O administrador principal pode acrescentar uma anotação por meio do diário existente, sem que isso certifique pagamento.

## Controle de acesso e integridade

RPC SQL somente leitura `public.admin_owner_payout_archived_critical_v1_344(uuid,integer)` valida `superadmin` ou `finance`, páginas alinhadas a múltiplos de 30 e limite máximo de deslocamento. Apenas `service_role` recebe EXECUTE; `anon` e `authenticated` não recebem acesso. Edge `admin-ops` valida novamente papel, número de registros, valores, classificação de anulação e ordem dos casos.

As respostas declaram `bankSettlementVerified=false`, `recipientVerified=false`, `moneyMoved=false`, `providerObservationIsBankProof=false`, `readOnly=true`. Nenhum pagamento, devolução, crédito, cobrança ou alteração de situação administrativa é disparado por essa consulta.

## Provas e limites

`tests/payout-archived-critical-watch-v1-344.mjs`: contrato de acesso, critérios históricos, preservação de observações de sucesso, paginação, interface, permissões, rejeição de respostas contraditórias e marcadores de ausência de liquidação bancária.

A execução SQL em produção sem transações reais valida a estrutura, permissões e resposta vazia, **não** demonstra recuperação monetária. Para casos reais é necessário confirmar extrato bancário, destinatário e condições do PSP por processo independente.

Publicação condicionada à auditoria, build e reconciliação do commit dos três portais, mantendo `PRELAUNCH` e `commerce_enabled=false`.
