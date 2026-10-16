# TAMÃO V1.341 — Paginação global das pendências de repasse

Data: 16/10/2026. Área: Admin → Aquisição / Financiamento → Pendências de todas as competências.

## Limite encontrado na V1.340

O painel já identificava casos de todas as competências e mostrava contadores completos, mas o quadro de resultados era limitado às **30 declarações de maior prioridade**. Não havia uma maneira de acessar diretamente as demais declarações globais sem pesquisar manualmente mês a mês.

## Implementação V1.341

Mantém intactos o RPC V1.340 e a consulta inicial. Acrescenta a função de leitura `public.admin_owner_payout_global_followup_page_v1_341(p_actor uuid,p_offset integer)`, que usa o mesmo cálculo de elegibilidade, os mesmos totais globais e **a mesma ordenação determinística** por prioridade, vencimento e ID. O retorno tem os novos campos:

- `pagedV1341=true`, `queueCoverage='global_pages_30'`.
- `pageOffset`, `pageLimit=30`, `hasPrevious`, `hasMore`.
- Totais e marcadores financeiros preservados (`readOnly`, `administrativeOnly`, `bankSettlementVerified=false`, `recipientVerified=false`, `moneyMoved=false`).

O gateway `admin-ops` aceita a ação `owner-payout-global-followup-page` somente para `superadmin` e `finance`. Faz validação do deslocamento (múltiplos de 30, de 0 a 999990) e do resultado completo, inclusive quantidade de linhas esperada, coerência dos contadores e ordem de risco.

A interface mostra **Mostrando X–Y de N**, **Anterior**, **Próxima página** e mantém o botão **Abrir competência para revisar** em cada cartão, inclusive depois da primeira página. Filtros e totais são somente leitura.

## Limites e segurança

A lista global usa paginação por deslocamento. Se um administrador registrar uma análise enquanto percorre a fila, a ordenação e a quantidade de pendências podem mudar. Para evitar confusão, o operador deve atualizar a visão; a paginação **não é uma fotografia transacional congelada**.

A função SQL é `STABLE SECURITY DEFINER`, com `search_path` restrito, teste de administrador ativo, execução revogada para `anon`/`authenticated` e concessão somente a `service_role`. Não foi criada nenhuma função de escrita financeira ou de revisão; o diário V1.337 continua sendo o registro oficial.

Os prazos são internos de acompanhamento e não comprovam transferências externas, depósitos bancários ou pagamentos. Nenhuma cidade será aberta por esta atualização.

## Cobertura de testes

`tests/payout-global-pagination-v1-341.mjs` verifica contratos SQL/Edge, segunda página para declarações 31–35, botão de voltar, navegação por competência, bloqueio de deslocamentos inválidos, integridade dos dados recebidos, permissões e preservação da leitura sem movimentações. Incluído no Audit.

Antes de concluir a publicação: CI do GitHub, migração rastreada, verificação SQL e permissões no Supabase, correspondência do código `admin-ops` com GitHub, construção dos três portais, Cloudflare e prontidão `PRELAUNCH`.

O ambiente estava sem pedidos e sem declarações de repasse reais no início da auditoria. A paginação com múltiplos itens foi testada com dados sintéticos **fora** das tabelas de produção.
