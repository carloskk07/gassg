# TAMÃO V1.336 — Paginação segura da fila de repasses

Data: 16 de outubro de 2026 · Escopo: Admin → Aquisição / Financiamento → Central de revisão de repasses externos.

## Resultado

A central V1.335 apresentava os 30 registros de maior prioridade de uma competência, sem permitir alcançar os demais. A V1.336 adiciona navegação por todas as páginas disponíveis, com filtros locais **na página atual** e totais da competência preservados.

- Primeira página continua utilizando `owner-payout-provider-read` e `platform_payout_provider_private_v1_265.read` (compatível com a versão anterior).
- Demais páginas usam `owner-payout-provider-page`, encaminhada via `admin_owner_payout_provider_page_v1_336` para `platform_payout_provider_private_v1_265.read_page`.
- A nova RPC mantém os cálculos de toda a competência, o contrato financeiro estritamente observacional e a mesma ordenação por `priority, reported_at DESC, claim_id`.
- Retorno inclui `triageV1336`, `pageOffset`, `pageLimit=30`, `hasPrevious`, `hasMore` e `queueCoverage='paginated_30_prioritized'`.
- `p_offset` aceita apenas múltiplos de 30, de 0 até 999990, para limitar consultas custosas e bloquear valores inválidos. Não existem páginas duplicadas causadas por regras diferentes de ordenação entre chamadas estáticas. A consulta com OFFSET representa um retrato do momento; novas declarações ou alterações de risco entre páginas podem deslocar registros, exigindo nova atualização da competência.
- O frontend apresenta **Mostrando X–Y de N**, **Anterior** e **Próxima página**; nas respostas inválidas, descarta a lista existente. Mudança de mês durante uma solicitação impede que a resposta antiga substitua a competência atual.

## Controle de acesso

Apenas `superadmin` e `finance` podem consultar. O gateway administrativo valida sessão, cargo, período, offset, contagens, limites, assinatura dos dados e ausência de suposta verificação bancária. A RPC pública recebe somente `service_role` e executa nova verificação de administrador autorizado no banco.

Permissões `anon` e `authenticated` são explicitamente revogadas para a nova RPC; a função interna permanece em esquema privado, sem acesso para o público. Nenhuma função de escrita ou transferência é criada.

## Escopo de auditoria

O teste `tests/owner-payout-review-pagination-v1-336.mjs` cobre contratos SQL, permissão no gateway, paginação no painel, dados inválidos, navegação anterior/próxima, filtros e separação de leitura versus pagamentos. Os testes V1.335 continuam operando.

Antes de abrir qualquer cidade: inspecionar resultados da suíte Audit, instalação da migração, publicação da Edge Function `admin-ops` com o mesmo commit, build Cloudflare, verificação dos três portais e `PRELAUNCH`.

**Fase seguinte separada:** criar histórico de acompanhamento por declaração, com justificativa e auditoria imutável, sem confundir resolução administrativa com pagamento comprovado.

Até esta implantação, não havia pedidos nem declarações de repasses reais; nenhum pagamento pode ser inferido ou simulado como real.
