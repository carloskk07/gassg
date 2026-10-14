# TAMÃO V1.263 — Evidência de repasses externos de indicação

## Objetivo
Permitir ao fundador registrar **declarações sobre transferências externas** vinculadas a comissões de indicação liberadas. Cada declaração guarda o pedido de origem, o beneficiário verificado contra a concessão, o valor, provedor informado, referência de transação, data e impressão digital SHA-256 opcional de um comprovante. **Não executa pagamentos.** Não equiparar uma declaração, referência ou hash à confirmação independente de uma transação bancária.

## Regras de registro
- Apenas \`platform_admins.admin_role='superadmin'\` com \`active=true\` pode registrar ou retificar. \`finance\` pode consultar, não registrar ou retificar.
- O pedido deve existir em \`order_reward_grants\` e ter \`referrer_user_id\`, \`referral_pending_cents>0\`, \`matured_at\` definido e \`reversed_at IS NULL\`.
- **Valor exato** da comissão concedida, sem repasses parciais nesta fase. Data da transferência declarada não pode ser anterior à data de maturação nem futura. A função realiza esses controles dentro do banco, independentemente da UI.
- Referência deve ser identificador sem dados pessoais (8–120 caracteres, sem espaços); duplicações por \`(provider,provider_reference)\` são vedadas, inclusive para declarações retificadas. Há bloqueio transacional por pedido, que impede registros ativos simultâneos.
- A mesma declaração enviada novamente retorna \`alreadyRecorded=true\`. Uma declaração diferente para o mesmo pedido ativo falha.
- Retificação é feita por uma segunda tabela **apend-only**, com justificativa de 12 a 300 caracteres, autor e data; a declaração original permanece. A retificação não realiza estorno de Pix — é apenas um ajuste no controle de documentos.
- Os registros privados não são expostos diretamente aos papéis \`anon\`, \`authenticated\` e \`service_role\`; três wrappers executáveis exclusivamente por \`service_role\`, via Edge autenticada. Os dados do beneficiário e a referência completa não saem no relatório agregado; a UI recebe apenas os quatro primeiros e os quatro últimos caracteres da referência.

## Relatório administrativo
Em **Admin → Aquisição → Central de financiamento e crescimento → Resultados → Comprovantes declarados de repasses externos**, o administrador principal pode informar uma declaração, consultar a competência e retificar uma entrada existente.

Os resultados são agrupados por **data informada de transferência**, fuso do Brasil. Indicadores:
- \`reportedActiveCents\`: soma de declarações ativas inseridas manualmente.
- \`reportedEligibleNowCents\`: parcela das declarações ativas cujos pedidos ainda são concessões válidas e maduras.
- \`reportedNowIneligibleCents\`: valores declarados cuja concessão tornou-se inelegível após a declaração.
- \`reportedVoidedCents\`: valores de declarações retificadas.
- \`activeWithoutProofFingerprint\`: contagem de declarações sem SHA-256 informado.
- Histórico paginado nas últimas 30 declarações; totais mensais sempre incluem todas as linhas.

Essas grandezas **não** são \`externalPaidBenefitsCents\`: o campo continua \`null\`, \`externalPayoutMeasured=false\` e \`bankSettlementVerified=false\`. O SHA-256 é metadado declarado, não verificação automática do conteúdo, pois esta versão não possui upload nem download de documentos. A classificação bancária dependerá de conciliação futura por extrato/PSP ou documentos autenticados.

## Arquitetura
- Migração: \`supabase/migrations/20261014235900_owner_referral_external_payout_evidence_v1_263.sql\`.
- Tabelas RLS: \`platform_referral_payout_claims_v1_263\`, \`platform_referral_payout_voids_v1_263\`.
- API SQL: \`admin_owner_referral_payout_claims_v1_263\`, \`admin_owner_referral_payout_record_v1_263\`, \`admin_owner_referral_payout_void_v1_263\`.
- Edge: \`owner-benefit-payout-read\`, \`owner-benefit-payout-record\`, \`owner-benefit-payout-void\`.
- Navegador: \`adminOwnerPayoutReadFromUi\`, \`adminOwnerPayoutRecordFromUi\`, \`adminOwnerPayoutVoidFromUi\`.
- CI: \`tests/owner-referral-payout-evidence-v1-263.mjs\`.

## Limitações
Não incluir cashback ou Clube em \`reportedActiveCents\`: a primeira etapa restringe declarações à comissão de indicação. Com a base financeira vazia, as respostas zeradas e ACLs são verificáveis, mas o comportamento de registro ainda não foi exercitado com repasses reais. Não criar transações fictícias em produção nem ativar novos benefícios para testar. Próximo avanço: oferecer upload seguro de comprovantes com hash derivado de bytes, integração de extratos/PSP e confronto com valor, beneficiário, referência, data e status — somente então oferecer o atributo \`bankVerified\`.
