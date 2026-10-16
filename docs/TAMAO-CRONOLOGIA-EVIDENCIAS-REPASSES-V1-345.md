# TAMÃO V1.345 — Cronologia das evidências de repasse e estorno

Data: 16/10/2026. Escopo: Admin → Aquisição/Financiamento → Exceções críticas com histórico preservado.

## Defeito encontrado

Na V1.344, a consulta de exceções críticas exigia que a concessão estivesse revertida e existisse **alguma** observação positiva do provedor. Entretanto, não comparava `checked_at` com `reversed_at`. Isso permitia que a interface chamasse de “sucesso anterior observado” um retorno positivo capturado somente **depois** do estorno.

A observação é um registro do momento em que a consulta ao PSP ocorreu, **não o horário real em que o dinheiro eventualmente circulou**.

## Correção implementada

- Preserva todas as exceções históricas da consulta anterior, mantendo anulados e encerrados.
- Identifica `min(checked_at)` de todas as observações com `provider_transaction_success=true` por declaração.
- Compara o primeiro horário observado com `reward_reversed_at`: até o estorno, inclusive, ou somente depois dele.
- Retorna `firstProviderSuccessObservedAt` e `successObservedBeforeOrAtReversal` em cada linha.
- Contadores gerais: `firstSuccessObservedBeforeOrAtReversalClaims` e `firstSuccessObservedAfterReversalClaims`, cuja soma deve igualar o número total de exceções.
- Marca `observationChronologyV1345=true`. O gateway e a interface rejeitam dados ausentes, totais contraditórios ou classificação incoerente com os timestamps.
- No cartão, mostra primeira observação positiva e estorno separadamente; não afirma que houve repasse antes do estorno sem prova bancária.

Nenhuma observação positiva é apagada mesmo que tenha ocorrido após o estorno; ela permanece visível porque pode exigir verificação independente.

## Limites

A primeira observação positiva **não é prova** de liquidação bancária, da identidade do destinatário nem da data efetiva da transferência. Este relatório permanece somente leitura, sem criar cobrança, reversão, pagamento, comissão ou evento novo. `bankSettlementVerified=false`, `recipientVerified=false`, `moneyMoved=false`.

A correção atinge a visão **histórica de exceções da V1.344**. Demais métricas globais de sucesso histórico indicam existência da observação, não uma sequência temporal certificada.

## Testes e controle de publicação

`tests/payout-archive-observation-chronology-v1-345.mjs` confere contrato SQL, ausência de escrita financeira, ACL, timestamps, contadores, sinais da API, UI e classificação de observações anteriores/posteriores/iguais ao estorno. A fixture da V1.344 foi estendida para conter um caso de cada tipo.

Após CI: aplicar migração rastreada, verificar `pg_get_functiondef`, permissões e relatório SQL somente leitura, atualizar Edge `admin-ops` para o código versionado, comprovar três portais e preservar `PRELAUNCH`.
