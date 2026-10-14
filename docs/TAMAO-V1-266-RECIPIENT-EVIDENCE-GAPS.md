# TAMÃO V1.266 — Fila de evidências da identidade do beneficiário

## Decisão técnica
A consulta oficial **GET** do Mercado Pago Payouts (V1.265) devolve transação, status, valor e referência, mas não oferece nessa resposta um identificador de conta de destino que o TAMÃO consiga ligar, de maneira independente, ao usuário destinatário da comissão. Mesmo o status \`success/accredited\` não deve ser confundido com **prova de titularidade** de quem recebeu o dinheiro.

A V1.266 implementa uma **fila administrativa de evidências faltantes**. Não cria cadastro obrigatório de dados bancários, não solicita CPF/chave Pix, não faz transferências nem eleva declarações à categoria de liquidação confirmada.

## Comprovação em camadas
Cada declaração já existente em V1.263 é confrontada com:
1. **Concessão** em \`order_reward_grants\`: pedido de origem, \`referrer_user_id\` igual ao beneficiário do registro de repasse, valor integral concedido, maturação e ausência de reversão.
2. **Carteira** em \`wallet_entries\`: exatamente um lançamento de pendência positiva, um débito de pendência, um crédito disponível e nenhuma reversão, com valores e beneficiário/bucket corretos. Duplicidades e inconsistências não passam.
3. **Resposta do provedor** em V1.265: apenas a última observação para a declaração, com status \`success/accredited\`, correspondência de valor/referência com os valores originalmente registrados e validade da concessão na ocasião; concessão revogada ou declaração retificada invalida o sucesso atual.
4. **Arquivo documental** em V1.264: apenas existência de metadados de comprovante anexado. A integridade efetiva dos bytes deve continuar sendo revisada no endpoint de V1.264; a presença do arquivo não comprova autenticidade ou liquidação.
5. **Titularidade bancária de destino**: **NÃO DISPONÍVEL**. A implementação mantém \`recipientVerified=false\`, \`bankSettlementVerified=false\` e \`externalPaidBenefitsCents=null\`.

## Resultado no painel
A função privada \`platform_recipient_proof_private_v1_266.report\` permite identificar por declaração:
- \`internalRecipientMatchesGrant\`: o ID do indicador na concessão é o mesmo do beneficiário do registro interno. Não significa titularidade bancária.
- \`walletVerified\`, \`proofAttached\`, \`providerObserved\`, \`providerMatchedNow\`.
- \`readyForRecipientProof\`: etapas internas, consulta do provedor e metadados documentais coincidem, faltando prova externa de titularidade.
- \`missingEvidence\`: códigos de pendências, incluindo concessão cancelada, carteira divergente, provedor não suportado, consulta oficial ausente, divergência de status/referência, comprovante ausente e \`recipient_destination_not_independently_verified\`.

São exibidas até 50 declarações do mês selecionado, agrupadas pela data **informada** da transferência. Os totais incluem o conjunto integral de declarações no mês. Não há CPF, chave Pix, conta bancária, endereço ou lista de beneficiários expostos pelo relatório.

## Controles de acesso
\`public.admin_owner_recipient_evidence_gaps_v1_266(uuid,date)\` é um wrapper \`SECURITY INVOKER\` com \`EXECUTE\` concedido apenas a \`service_role\`. A função real está em schema privado, confere no banco \`platform_admins.active=true\` e perfil \`superadmin\` ou \`finance\`. A Edge \`admin-ops\` aplica os mesmos filtros e rejeita qualquer payload incompatível com o contrato, inclusive tentativas de apresentar valores pagos/comprovados sem fonte independente. A interface isola os resultados por sessão e papel.

Nenhuma tabela financeira foi modificada e não existem funções de escrita na V1.266. A consulta não habilita novos benefícios, repasses ou cadastro de dados pessoais.

## Pré-requisito para confirmação futura
Antes de qualquer \`recipientVerified=true\`, será necessária uma fonte independente que contenha o identificador validado da conta de destino, confrontável com uma identidade de beneficiário obtida de forma legítima e minimizada. O retorno documentado atualmente na API GET não oferece esse confronto. Uma declaração do administrador ou um comprovante PDF pode ajudar a investigar, mas não substitui a confirmação oficial da instituição pagadora/destinatária.

## Testes
- SQL: migração \`20261014235955_recipient_evidence_gaps_v1_266.sql\`, sem inserir nem alterar transações.
- UI/Edge: \`tests/owner-recipient-evidence-gaps-v1-266.mjs\`, ligado ao fluxo de auditoria.
- Produção: ACL e consulta na base real (atualmente sem concessões/comprovantes/observações); não criar testes financeiros falsos.

Fontes oficiais: https://www.mercadopago.com.br/developers/en/docs/payouts/resources/endpoints-map e https://www.mercadopago.com.br/developers/en/docs/payouts/resources/transaction-status-and-errors .
