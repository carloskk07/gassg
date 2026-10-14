# TAMÃO V1.262 — Rastreabilidade das comissões de indicação

## Escopo
Conciliação por **pedido gerador** e **usuário indicado para receber a comissão** entre:
- \`order_reward_grants\`, registro da concessão e das datas \`created_at\`, \`matured_at\` e \`reversed_at\`;
- \`wallet_entries\` (eventos \`referral_pending\`, \`referral_pending_release\`, \`referral_available\` e \`referral_reversal\`), identificados por \`order_id\`, usuário, bucket, tipo e valor;
- \`platform_owner_campaign_order_attributions_v1_252\`, somente associação UTM de pedido a campanha. Não é evidência causal de marketing.

Esta versão é **somente leitura**. Não altera a carteira, não concede/reverte valores, não acelera maturação e não cria caminho de pagamento.

## Estados das concessões por pedido de origem
| Estado atual | \`matured_at\` | \`reversed_at\` | Lançamentos esperados |
|---|---|---|---|
| Pendente | NULO | NULO | 1 pending |
| Disponível | preenchido | NULO | 1 pending, 1 pending_release, 1 available |
| Revertida antes de liberar | NULO | preenchido | 1 pending, 1 pending_release; sem available/reversal |
| Revertida depois de liberar | preenchido | preenchido | 1 pending, 1 pending_release, 1 available, 1 reversal |

\`referral_pending_release\` aparece tanto na **maturação** quanto na **reversão anterior à maturação**; não pode ser classificado sem consultar a concessão original. Uma comissão que *apenas está disponível* **não foi paga**. O relatório só marca um ciclo como conciliado se contagens, valores positivos/negativos e destinatário/compartimento coincidirem exatamente; ausências, duplicidades e destinatários divergentes aparecem como não conciliados.

## Dois eixos distintos
1. **Coorte de emissão:** concessões criadas dentro da competência (São Paulo). Os estágios apresentados refletem a **situação atual** desses pedidos, mesmo que a maturação ou a reversão tenha ocorrido em outro mês. Campos: concedido, pendente, disponível, revertido antes/depois da maturação, conferido/não conferido. A soma das quatro categorias de estado corresponde exatamente ao concedido na coorte; a soma conferido + divergente também.
2. **Movimentações no mês:** eventos \`wallet_entries.created_at\` de qualquer origem. Campos: pendências criadas/baixadas, disponíveis adicionadas/revertidas, número total e eventos sem concessão original válida. Esses valores **não** devem ser somados à coorte como novos custos ou novos pagamentos.

### Por campanha
O recorte por campanha inclui até 50 alocações da competência, vinculando concessões a pedidos através de atribuição por UTM validada. Os estados são os atuais das concessões daquele mês, não gastos imputados à campanha ou receita incremental.

## Segurança
A migração \`20261014235500_referral_commission_lifecycle_v1_262.sql\` instala a função privada \`platform_referral_trace_private_v1_262.report\`, invocada exclusivamente pela RPC \`public.admin_owner_referral_lifecycle_v1_262\` via \`service_role\`. Há autorização adicional explícita em SQL para \`platform_admins.active\` e função \`superadmin\` ou \`finance\`, além do gate de função na Edge \`admin-ops\`. O navegador nunca recebe credenciais de serviço nem dados individuais de pedidos/usuários; só agregações.

Admin → Aquisição → Central de financiamento e crescimento → Resultados → **Conciliação das comissões de indicação**.

## Métricas que NÃO existem
\`externalPaidReferralCents=null\`, \`externalPayoutMeasured=false\`. A plataforma ainda não possui uma trilha auditável de saques e de comprovantes externos por indicador para afirmar que a comissão foi efetivamente enviada ou recebida. O relatório não apresenta lucros, ROI, saldos bancários, causalidade publicitária ou pagamentos executados.

## Validação
O helper puro \`stage()\` pode ser testado no SQL com as quatro combinações de \`matured_at\` e \`reversed_at\` sem criar usuários, pedidos ou dados financeiros falsos. Teste de regressão Node em \`tests/owner-referral-lifecycle-v1-262.mjs\` com contrato de segurança, estados contábeis, API, UI, controle de papéis e resposta inválida. Os cenários com lançamentos financeiros reais só podem ser exercitados se existirem transações da operação.

## Próxima evolução
A rastreabilidade de pagamentos externos exige prova de transferência por beneficiário com referência idempotente do PSP/banco, autorização humana e conciliação contra o comprovante — **não** apenas a maturação da comissão na carteira.
