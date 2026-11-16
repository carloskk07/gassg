# TAMÃO V1.1043 — estornos permanecem ativos com a bonificação suspensa

## Defeito reproduzido por inspeção do código e da função publicada
A função `network_module_ads_bonus_refresh_v1_1041` retornava imediatamente ao observar `enabled=false`. Essa condição impedia tanto novas concessões (correto) como a **reversão de prêmios antigos** após cancelamento, contestação, estorno ou perda de comprovação NET (incorreto).

## Correção
A V1.1043 processa primeiro a invalidação de prêmios previamente registrados; só então consulta `enabled` para impedir novas apurações. Mesmo com a política suspensa, a resposta retorna quantidade de reversões efetivas e nenhuma nova concessão. O teste inclui duas execuções para assegurar idempotência. O status do checkout e do PSP usa comparação nula-segura.

- A política continua `enabled=false` após a migração. Termos legais seguem sem aprovação ou publicação automática.
- A correção é restrita à função financeira interna, só com permissão `service_role`, sem novas tabelas, sem endpoints públicos e sem mudanças em carteiras ou Pix.
- A reversão acontece quando a rotina de atualização é executada (p.ex. durante uma visita autenticada à Rede). Ela **não implica vigilância instantânea** do PSP nem um cron novo.
- Testes: contrato JS `tests/network-cross-module-benefits-v1-1041.mjs` e fluxo SQL em PostgreSQL descartável `tests/sql/network-cross-module-benefits-v1-1041.sql`, sob transação com `ROLLBACK`.
- Não confundir correção de segurança com liberação comercial; aprovação de termos e autorização de saques continuam separadas.
