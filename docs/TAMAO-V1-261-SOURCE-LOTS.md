# TAMÃO V1.261 — lotes de origem de cashback e associação FIFO contábil

## Entrega
A partir da implantação, cada lançamento positivo de cashback na carteira oficial cria um **lote de escrituração** associado à entrada imutável \`wallet_entries.id\`, ao usuário e ao tipo \`cashback_seed\` ou \`cashback_earn\`. Para um lançamento \`cashback_reserve\`, a camada auxiliar atribui valor aos lotes ainda disponíveis do mesmo usuário, do mais antigo ao mais recente. O vínculo mantém o identificador do evento de reserva e do lote de origem; nunca cria ou altera crédito real. A liberação vinculada ao pedido retorna valores aos mesmos lotes de origem. Uma reversão de crédito de cashback retira, quando possível, o valor não consumido dos lotes oriundos daquele pedido.

**FIFO é uma convenção contábil de rastreamento de saldos fungíveis.** Não significa identificar fisicamente dinheiro nem garante que créditos já existentes tenham origem rastreável. O total gasto no pedido permanece controlado pela carteira e pelo motor financeiro oficial. Não substitui as conciliações V1.259 e V1.260.

## Segurança operacional
- Um trigger \`AFTER INSERT\` em \`wallet_entries\` aplica a escrituração automaticamente somente a lançamentos de cashback. Não altera \`wallet_entries\`, \`orders\` ou \`order_reward_grants\`.
- A escrituração é **fail-open** para proteger os pedidos. Quando a vinculação falha, o evento original continua válido e a ausência é detectável pelo painel.
- Uma reserva maior que o total rastreável produz diferença explícita; não se cria lote falso nem se registra saldo negativo.
- Lançamentos negativos são registrados como reservas/reversões, nunca como nova concessão.
- A liberação retorna apenas valores que foram previamente reservados no mesmo pedido; devoluções adicionais são não vinculadas.
- O relatório só contabiliza reservas completamente vinculadas quando o pedido está atualmente liquidado, com pagamento confirmado, não revertido e sem devolução registrada.
- Trigger não bloqueia os processos de retenção: as tabelas auxiliares usam vínculos com \`on delete cascade\` e o ajuste de migração torna as proteções de imutabilidade restritas à alteração de eventos (sem impedir cascatas).
- RLS em três tabelas, sem acesso direto dos papéis \`anon\`, \`authenticated\` e \`service_role\`. A consulta ocorre por wrapper RPC \`service_role\`, a partir da Edge \`admin-ops\`, com checagem do papel \`superadmin\`/\`finance\`.

## Indicadores
Em Admin → Aquisição → Central de financiamento e crescimento → Resultados, o botão **Consultar rastreabilidade da competência** mostra:
- número de eventos de cashback, capturados, sem captura e parcialmente rastreados;
- novos lotes e suas emissões por tipo (crédito inicial / recompensa);
- saldo contábil corrente referente aos lotes emitidos na competência selecionada;
- uso com reserva totalmente vinculada e pedido atualmente liquidado, versus uso parcial ou sem vínculo;
- até 50 campanhas do mês com lotes originados de recompensas de pedidos associados a UTM, sem supor causalidade.

Nenhum identificador pessoal, de pedido ou de lote é exposto pela resposta agregada. O painel não autoriza transferências, resgates, ajustes, liberação automática ou qualquer pagamento.

## Limites e reconciliação
- **Sem retroatividade:** registros anteriores à implantação não são inventados nem reclassificados. \`untrackedEntries\` informa eventos que existam fora da captura (inclui falhas).
- O saldo contábil atual de lotes de uma competência não é posição histórica no fechamento daquele mês, nem saldo utilizável da carteira.
- Recompensas revertidas cujo saldo já foi utilizado não permitem gerar valor negativo fictício no lote; parte não associada é evidenciada.
- O retorno de lançamento posterior pode alterar o saldo contábil disponível; nunca se chama isso lucro ou pagamento.
- \`externalPaidBenefitsCents\` permanece \`null\` e \`externalPayoutMeasured=false\`. Não há livro de saques ou prova bancária, logo não há cálculo de lucro ou ROI.
- A captura traz trabalho adicional ao banco. Monitorar latência de criação de pedidos quando a operação e o número de lotes crescerem; usar índices FIFO e considerar compactação por coorte sem destruir auditabilidade.

## Artefatos
- Migrações: \`20261014235000_cashback_source_lots_v1_261.sql\` e \`20261014235100_cashback_trace_retention_v1_261.sql\`.
- Backend: Edge \`admin-ops\`, RPC \`admin_owner_cashback_source_lots_v1_261\`.
- UI: \`js/admin-acquisition.js\`, \`js/bootstrap.js\`.
- Regression: \`tests/owner-cashback-source-lots-v1-261.mjs\`.

## Próximas evoluções
Para conhecer o custo efetivamente pago, criar registros de liquidação externa conciliáveis com PSP/banco. Para rastreio além de cashback, adicionar programa de lote de comissões em uma próxima versão, com regras próprias de maturação e reversão, sem presumir que o saldo disponível foi sacado.
