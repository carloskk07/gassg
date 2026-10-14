# TAMÃO V1.265 — consulta independente de status de saídas pelo Mercado Pago Payouts

## Origem oficial
API Mercado Pago Payouts, **não** API Payments usada em recebimentos:
GET \`https://api.mercadopago.com/v1/payouts/{payout_id}/transactions/{transaction_id}\`.
Documentação oficial:
- https://www.mercadopago.com.br/developers/pt/docs/payouts/resources/endpoints-map
- https://www.mercadopago.com.br/developers/en/reference/online-payments/payouts/get-transaction-information/get
- https://www.mercadopago.com.br/developers/pt/docs/payouts/resources/transaction-status-and-errors

É uma integração **somente de leitura**. Nenhum endpoint POST /v1/payouts, PUT, cancelamento, saque ou transferência foi adicionado. O recurso oficial requer habilitação de Payouts para a conta do proprietário; um token de cobrança tradicional não é prova de permissão para consultar saídas.

## Segurança da credencial
A Edge usa exclusivamente o segredo **\`MERCADOPAGO_PAYOUTS_READ_ACCESS_TOKEN\`** (token restrito à integração Payouts da conta que originou o desembolso). Não compartilha nem reutiliza o token do Mercado Pago de pagamentos recebidos da revenda ou do TAMÃO. O segredo não é enviado ao navegador e não é gravado no banco.

Se ausente, o endpoint retorna \`configured=false\`, \`checked=false\`, \`reason=outgoing_payouts_credentials_missing\`. Nesse estado **nenhuma consulta é feita** e nenhum lançamento de confirmação é criado. Credenciais de Payouts e autorização do produto devem ser configuradas explicitamente por um administrador quando a conta tiver acesso.

## Requisitos de conciliação
- A declaração V1.263 deve estar ativa, ter \`provider='mercado_pago'\`, beneficiar usuário elegível e ter concessão madura não revertida.
- Os IDs informados pelo fundador precisam ter formato oficial de lote \`POP...\` e transação \`TOP...\`; a Edge consulta o endpoint HTTPS fixo com \`GET\`, \`redirect:error\` e timeout 9 segundos.
- A resposta deve ter o mesmo \`transaction_id\`, valor em reais com no máximo 2 casas, moeda BRL, referência externa de 8–120 caracteres e carimbo de atualização válido. A API não recebe campos financeiros definidos pelo navegador, apenas os IDs.
- Ao receber HTTP 200, a Edge calcula SHA-256 dos **bytes do corpo retornado** e grava observação imutável junto com o status e os resultados da comparação. O banco rejeita duplicidade de uso da **mesma transação** por duas declarações diferentes. Status antigos ficam no histórico; o painel considera somente a última observação de cada declaração.
- \`providerTransactionSuccess\` pode ser verdadeiro apenas se a API retornou \`status='success'\`, \`status_detail='accredited'\`, a referência e o valor coincidirem, e a comissão estiver atualmente elegível.
- Uma observação futura de erro ou uma reversão da concessão retira a classificação de sucesso atual do relatório. **Não se soma o histórico de observações como pagamentos.**

## O que ainda NÃO está comprovado
A resposta documentada de \`GET /v1/payouts/{payout_id}/transactions/{transaction_id}\` retorna ID, status, referência e valor, mas não garante um identificador de destinatário que o TAMÃO possa comparar à identidade bancária verificada do indicador. Por isso:
- \`recipientVerified=false\`
- \`bankSettlementVerified=false\`
- \`providerTransactionIsBeneficiaryProof=false\`
- \`externalPaidBenefitsCents=null\`

Ou seja, a plataforma passa a saber **o que o provedor respondeu sobre uma transação**, mas não pode extrapolar para "a comissão chegou ao beneficiário correto". Também não deve usar esse registro para liberar saques ou conferir repasses de clientes para revendas.

## Exposição administrativa
Em Admin → Aquisição / Financiamento → Consulta externa de repasses — Mercado Pago Payouts, o superadmin informa o ID da declaração e os IDs oficiais do payout/transferência preexistentes. O perfil financeiro só lê as observações, não chama o provedor. A consulta não habilita pagamentos.

## Artefatos
- \`supabase/migrations/20261014235945_mp_payout_provider_observations_v1_265.sql\`: tabela com RLS e RPCs somente service_role, autorização dupla no banco/Edge.
- \`supabase/functions/admin-ops/index.ts\`: endpoint de consulta e resumo.
- \`js/admin-acquisition.js\`, \`js/bootstrap.js\`: interface.
- \`tests/owner-mp-payout-provider-v1-265.mjs\`: regressão do fluxo.

## Testes em produção
A base pode conter **zero** concessões/declarações e não possuir token de Payouts. Nessa situação, validar ACL, retorno agregado vazio, token ausente e testes de contrato sem inventar pagamentos. A execução real de GET depende de um identificador oficial de transferência de saída existente na conta com Payouts habilitado. Não usar IDs falsos e nem criar payout para "testar".
