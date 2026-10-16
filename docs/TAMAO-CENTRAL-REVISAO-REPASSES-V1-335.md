# TAMÃO V1.335 — Central de revisão de repasses externos

Data: 16/10/2026 · Interface: Admin → Aquisição / Financiamento → Mercado Pago Payouts.

## Objetivo e decisão

A V1.334 passou a detectar declarações de comissão revertidas após observação positiva de transação no PSP, mas a apresentação administrativa ainda era cronológica, ocultando pendências críticas quando havia mais de 30 declarações na competência. Faltavam identificação do pedido, valor nominal declarado, próximos passos e uma operação simples para preparar nova consulta read-only.

## Implementação

O RPC somente leitura `platform_payout_provider_private_v1_265.read` conserva as métricas **de toda a competência**. A página de até 30 itens passa a ordenar as declarações por gravidade e data:

1. Pedido revertido e declaração ativa com **sucesso histórico observado** no provedor.
2. Pedido revertido e declaração ativa, sem sucesso histórico observado.
3. Valor ou referência divergentes na última consulta externa.
4. Declaração ainda sem consulta do provedor.
5. Declaração ativa sem comprovante privado.
6. Demais declarações e registros retificados, mantidos para auditoria.

Em caso de empate, mais recente primeiro, depois ID. O registro agora inclui `orderId`, `reportedAmountCents`, `paidOn`, `reportedAt`, `priority`, além das evidências de V1.334.

A UI usa cartões acessíveis no fluxo responsivo, com ID do pedido, ID da declaração, valor, status observado, coincidência de referência/valor, existência de comprovante, estorno, sucesso histórico e próximo passo indicado. São exibidos os totais da competência separadamente da amostra prioritária; filtros **Todos**, **Estornos prioritários** e **Pendências** operam só sobre os 30 registros carregados.

O perfil financeiro pode visualizar e filtrar. Somente o superadmin pode **preparar** uma nova consulta existente: a ação preenche o formulário com IDs conhecidos POP/TOP e **não dispara** a consulta externa, que exige clique explícito no comando de GET já existente. Não permite gerar pagamentos, quitar pendências, estornar, cobrar, baixar documentos sem autorização ou tomar decisões automáticas.

## Integridade e limites

Resposta do RPC validada no frontend: assinatura V1.335, limites, valores, ordem por prioridade, IDs, evidências obrigatoriamente booleanas, números não negativos, ausência de autorização de recuperação automática e incompatibilidades de contagens agregadas. Falhas bloqueiam a exibição da resposta, não criam estado de sucesso falso.

A observação positiva `provider_transaction_success=true` **não** comprova depósito bancário nem titularidade do recebedor. `bankSettlementVerified=false`, `recipientVerified=false`, `externalPaidBenefitsCents=null`, `noTransfers=true` e `readOnly=true` permanecem.

A visão continua limitada a 30 registros por competência. A métrica superior corresponde ao mês inteiro; um cartão ausente da página não significa pendência resolvida. Não há alteração em contas, lançamentos, saldos ou frequência dos trabalhos financeiros.

## Testes

- `tests/owner-payout-review-queue-v1-335.mjs`: prioridade, tipos de pendência, filtros, ordem, ACL, preparação sem disparo de GET e bloqueio de payload inconsistente.
- `tests/owner-mp-payout-provider-v1-265.mjs`: fixture original atualizada para o contrato V1.335.
- Workflow Audit, build dos portais, pronta entrega e reconciliação Cloudflare.
- SQL de produção: checar `pg_get_functiondef` antes e depois da migração.

O ambiente auditado antes da mudança tinha **zero** pedidos, concessões, declarações e observações externas. Nenhum caso bancário real pode ser inferido desse estado.
