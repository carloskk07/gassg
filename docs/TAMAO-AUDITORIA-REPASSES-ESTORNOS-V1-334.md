# TAMÃO V1.334 — Rastreabilidade de repasses de indicação após estornos

Data: 16/10/2026. Fonte: definições em produção do Supabase e auditoria do GitHub.

## Situação identificada

A área administrativa de reconciliação de repasses externos de indicação `platform_payout_provider_private_v1_265.read` expunha o total de alegações que ainda satisfazem as regras de concessão e as divergentes. Uma observação anterior de `provider_transaction_success=true` poderia deixar de aparecer como sucesso atual após o estorno financeiro do pedido, o que é correto para elegibilidade atual.

Entretanto, sem indicador separado, o operador precisava inspecionar os registros históricos manualmente para distinguir: (a) divergência de referência ou valor; (b) alegação cancelada; (c) **comissão revertida depois de ter uma observação de sucesso no provedor**.

A observação de sucesso é evidência limitada à resposta e às verificações executadas no momento; **não garante depósito bancário, identidade do destinatário ou pagamento comprovado do benefício**.

## Evolução sem movimentação financeira

A função de leitura administrativa agora fornece:

- `activeReversedClaims`: quantidade de declarações de repasse ativas cujo benefício atual foi revertido.
- `activeReversedReportedCents`: valor nominal reportado dessas declarações (não é dinheiro recebido nem obrigação confirmada).
- `reversedWithHistoricalProviderSuccessClaims`: casos revertidos que possuem uma observação histórica positiva do provedor, incluindo os posteriormente anulados.
- `activeReversedWithHistoricalProviderSuccessClaims`: subconjunto ativo que demanda priorização de conferência.
- Por linha: `grantReversedNow`, `historicalProviderSuccessObserved`, `requiresReversalReview`.

A consulta usa `EXISTS` por `claim_id` nos registros históricos e por isso não perde a observação positiva se depois houver observação de erro ou estado diferente. A contagem não duplica declarações com várias observações de sucesso. Um comprovante anulado deixa de ser uma pendência ativa, mas a evidência histórica permanece rastreável.

As métricas originais são mantidas. Os campos `bankSettlementVerified=false`, `recipientVerified=false`, `externalPaidBenefitsCents=null`, `readOnly=true` e `noTransfers=true` continuam explícitos. A atualização não cria estornos, saldo negativo, obrigação de recuperação, lançamento em carteira ou transferência de fundos.

## Testes e publicação

O teste `node tests/referral-payout-reversal-evidence-v1-334.mjs` verifica o contrato SQL, os limites de autoridade, o histórico de sucesso independente da última resposta, a preservação da evidência em declarações anuladas, os totais de demandas ativas e as salvaguardas de comunicação.

A implantação do SQL é uma migração rastreada após o CI, com verificação da função no banco, dos indicadores de segurança e do estado de lançamento comercial.

## Limites da evidência

O banco de produção possui zero pedidos, zero concessões de indicação, zero declarações de repasse e zero observações do provedor no momento desta auditoria. A mudança melhora a **detecção preventiva** de inconsistências, mas não prova a existência de problemas reais de repasse, nem confirma transações externas. Uma possível recuperação exigiria documentação e decisão administrativa própria, não um débito automático.
