# Chama — Edge Function contract v1.7.2

O browser usa publishable key + JWT. Dados reais da aplicação não são lidos/escritos diretamente pelo Data API.

## Auth boundary

- publishable key não prova identidade;
- toda Edge Function valida Bearer JWT;
- cliente pode ser Anonymous Auth;
- revenda precisa ser identidade permanente;
- autorização de revenda vem de `merchant_members`;
- `driver` não possui acesso operacional até existir assignment;
- service role fica somente no runtime Edge;
- payload JSON máximo: 16 KB;
- quotas são consumidas atomicamente no Postgres.

## get-offers

Cliente autenticado envia:

```json
{
  "address": "Rua ...",
  "items": [
    {"productCode":"P13","quantity":1}
  ]
}
```

A função:

- normaliza endereço/cesta;
- filtra revendas online/ativas/frescas;
- revalida preço e estoque;
- persiste quote + itens atomicamente;
- reutiliza snapshot idêntico ainda válido;
- limita requisições por minuto e hora;
- devolve no máximo opções anonimizadas;
- nunca devolve `merchant_id`, nome, CNPJ, telefone ou endereço da revenda.

## create-order

Header obrigatório:

`Idempotency-Key`

Body:

```json
{
  "quoteId": "uuid",
  "paymentMethod": "pix",
  "useCashback": true,
  "referralCode": "ABC123"
}
```

Regras:

- quote pertence ao usuário;
- quote válido e não consumido;
- estoque revalidado;
- preço vem do snapshot;
- um pedido ativo por cliente;
- referral novo somente antes do primeiro pedido;
- cashback calculado do ledger;
- economia da plataforma é snapshotada na criação;
- corrida de pedido duplicado retorna conflito.

## get-order

Projeção mínima para cliente ou membro operacional da revenda.

Cliente recebe:
- endereço próprio;
- itens/totais;
- fornecedor somente após aceite;
- eventos;
- PIN apenas após dispatch;
- estado financeiro e reversão, quando aplicável.

Revenda:
- precisa ser `owner/manager/operator`;
- não recebe endereço em `OFFERED_TO_MERCHANT`.

## customer-action

Ações:

- `cancel-before-accept`
- `accept-requote`

Requote:
- itens + taxa congelados;
- validade de 5 minutos;
- aumento exige aceite explícito.

## customer-summary

Retorna apenas agregado:

- referral code;
- cashback;
- comissão pending;
- comissão available;
- compras liquidadas válidas;
- quantidade revertida;
- elegibilidade para comissão em dinheiro;
- tipo de identidade.

Nunca devolve ledger bruto.

## merchant-orders

Somente identidade permanente com membership operacional.

Retorna:
- perfil operacional da revenda;
- memberships operacionais;
- catálogo autorizado;
- pedidos ativos;
- endereço mascarado antes do aceite.

## merchant-ops

Ações:

- `heartbeat`
- `set-online`
- `update-product`
- `update-logistics`

`heartbeat/set-online`: owner/manager/operator.

Alteração de catálogo/logística: owner/manager.

## merchant-action

Ações:

- `accept`
- `reject`
- `dispatch`
- `arriving`
- `cannot-fulfill`

Todas exigem owner/manager/operator e `expectedVersion`.

`cannot-fulfill` só é permitido antes do dispatch e usa motivo operacional restrito. O banco recompõe estoque e chama rescue central.

## complete-delivery

Body:

```json
{
  "orderId": "...",
  "pin": "1234",
  "expectedVersion": 8,
  "paymentConfirmed": true
}
```

Header:

`Idempotency-Key`

Regras:

- owner/manager/operator;
- status `ARRIVING`;
- pagamento precisa estar explicitamente confirmado;
- PIN de quatro dígitos comparado com hash;
- máximo cinco falhas;
- sucesso grava PAYMENT_CONFIRMED, DELIVERED e SETTLED;
- trigger gera rewards/receivables apenas após settlement.

## submit-merchant-application

Exige identidade permanente.

Valida:
- CNPJ numérico/alfanumérico;
- empresa;
- responsável;
- WhatsApp;
- endereço.

Cadastro fica pendente. Nunca ativa revenda automaticamente.

## admin-ops

Exige:

- Bearer JWT válido;
- identidade permanente;
- entrada ativa em `platform_admins`;
- quota server-side.

O login da interface administrativa usa `shouldCreateUser:false`; autenticar não concede privilégio.

Ações:

- `summary`: aplicações, merchants + compliance, contas financeiras em aberto e auditoria recente;
- `approve-application`: cria/vincula merchant como `pending` e applicant como owner;
- `reject-application`;
- `verify-merchant`: CNPJ/ANP + evidência/notas;
- `activate-merchant` / `suspend-merchant`;
- `financial-action`: baixa/compensação/waiver das contas server-side;
- `reverse-order`: chama autoridade atômica que reverte finanças e grava auditoria.

Gates de banco independentes da Edge/UI:

- merchant ativo/online exige CNPJ `verified`;
- P13 ativo em merchant ativo exige ANP `verified`.

## Idempotência e concorrência

Mutações usam:
- `Idempotency-Key`;
- request fingerprint;
- `action_requests`;
- `orders.version`;
- locks transacionais quando há dinheiro/estoque.

A mesma key + mesmo payload retorna resultado anterior. Mesma key + payload diferente falha.

## Financeiro server-only

Autoridades não expostas ao browser:

- `grant_order_rewards`
- `process_reward_maturation`
- `reverse_settled_order_financials`
- `merchant_financial_position`
- `process_data_retention`
- `process_anonymous_user_cleanup`
- `require_platform_admin`
- `admin_approve_merchant_application`
- `admin_verify_merchant`
- `admin_set_merchant_status`
- `admin_financial_action`
- `admin_reverse_settled_order`

### Buckets do wallet ledger

- `cashback`
- `commission_pending`
- `commission_available`

### Contas entre plataforma e revenda

- `platform_receivables`: taxa da plataforma;
- `merchant_cashback_reimbursements`: cashback usado pelo cliente a reembolsar à revenda;
- `platform_settlement_adjustments`: ajustes após reversões;
- `merchant_financial_position`: posição líquida server-side.

## Polling

O frontend piloto usa polling por Edge Function. Não depende de SELECT direto ou Realtime público em `orders`.
