# Chama — Edge Function contract v1.2

As funções abaixo serão a única superfície de escrita do piloto real. O browser usa somente publishable key + JWT do usuário. A secret/service key fica apenas no ambiente server-side.

## Auth boundary

- a publishable key identifica o componente público do app; ela não prova identidade do usuário;
- toda Edge Function extrai o Bearer JWT e valida a sessão com Supabase Auth antes de usar privilégios server-side;
- Anonymous Auth é aceito somente nos fluxos de cliente e deve usar CAPTCHA/rate limiting quando habilitado;
- ações de revenda rejeitam usuários com identidade anônima e exigem membership ativo;
- autorização nunca usa `user_metadata`; vínculo operacional vem de tabelas server-side como `merchant_members`;
- configuração de JWT/API key da Edge Function deve seguir a documentação vigente do Supabase no momento do deploy; a função continua fazendo validação explícita do usuário mesmo que a plataforma faça verificação adicional.

## 1. get-offers

**Quem chama:** cliente autenticado, inclusive Anonymous Auth.

**Entrada**

```json
{
  "address": "Rua ...",
  "items": [
    {"productCode":"P13","quantity":1},
    {"productCode":"WATER20","quantity":1}
  ],
  "priority": "recommended"
}
```

**Autoridade server-side**

- normaliza e valida endereço;
- valida quantidades e produtos;
- filtra somente revendas `active + online`;
- valida estoque;
- usa preços confirmados e ainda válidos;
- calcula distância/ETA no servidor;
- cria `quotes` e `quote_items`;
- quote expira rapidamente;
- não devolve nome, CNPJ, endereço, telefone nem `merchant_id`.

**Saída**

```json
{
  "offers": [
    {
      "quoteId": "opaque-uuid",
      "label": "recommended",
      "totalCents": 11990,
      "etaMinMinutes": 18,
      "etaMaxMinutes": 25,
      "trustScore": 97,
      "expiresAt": "..."
    }
  ]
}
```

## 2. create-order

**Cabeçalhos**

- JWT do usuário
- `Idempotency-Key` obrigatório

**Entrada**

```json
{
  "quoteId": "opaque-uuid",
  "paymentMethod": "pix",
  "useCashback": true,
  "referralCode": "ABC123"
}
```

**Regras**

- quote precisa pertencer a `auth.uid()`;
- quote não pode estar vencido nem consumido;
- o servidor relê estoque antes de criar;
- preço vem de `quote_items`, nunca do payload;
- cashback disponível é calculado do ledger;
- reserva de cashback gera entrada idempotente;
- quote é consumido na mesma transação lógica;
- cria `orders`, `order_items` e `order_events`;
- apenas um pedido ativo por cliente;
- resposta repetida com a mesma idempotency key retorna o mesmo resultado;
- mesma key com payload diferente é rejeitada.

## 3. merchant-action

**Quem chama:** usuário permanente vinculado à revenda.

**Entrada**

```json
{
  "orderId": "...",
  "action": "accept",
  "expectedVersion": 4,
  "idempotencyKey": "..."
}
```

Ações iniciais:

- `accept`
- `reject`
- `dispatch`
- `arriving`

**Regras**

- vínculo em `merchant_members` é obrigatório;
- pedido precisa estar atribuído à revenda;
- `expectedVersion` impede concorrência silenciosa;
- aceite reserva estoque de todos os itens de forma atômica;
- ao aceitar, grava `supplier_name_snapshot`;
- recusa reabre matching sem revelar a revenda recusada ao cliente;
- se nova opção for mais cara, status vira `REQUOTE_REQUIRED`;
- `dispatch` é o único caminho que produz “A caminho”;
- cada transição grava `order_events`.

## 4. customer-action

Ações iniciais:

- `cancel-before-accept`
- `accept-requote`

**Regras**

- cliente só age em pedidos próprios;
- cancelamento simples deixa de ser permitido após compromisso da revenda;
- aceite de re-cotação troca preço/fornecedor apenas após confirmação explícita;
- cashback reservado é recalculado e diferença devolvida pelo ledger.

## 5. complete-delivery

**Entrada**

```json
{
  "orderId": "...",
  "pin": "1234",
  "expectedVersion": 8,
  "idempotencyKey": "..."
}
```

**Regras**

- revenda/entregador precisa pertencer ao merchant do pedido;
- status precisa ser `ARRIVING`;
- comparar PIN com hash server-side;
- máximo de cinco falhas;
- PIN correto faz `DELIVERED -> SETTLED`;
- cashback entra uma única vez no bucket `cashback`;
- comissão de indicação só nasce após settlement real no bucket `commission_pending`;
- após o prazo antifraude, a liberação move valor de `commission_pending` para `commission_available` com duas entradas compensatórias;
- estoque e financeiro nunca são recalculados pelo browser.

## 6. update-catalog

- somente owner/manager;
- preço em centavos inteiros;
- estoque inteiro não negativo;
- atualização renova `price_confirmed_at`;
- mudança não altera pedidos/quotes já protegidos.

## 7. submit-merchant-application

- aceita CNPJ numérico e alfanumérico no formato atual;
- normaliza CNPJ antes de persistir;
- impede aplicação pendente/aprovada duplicada;
- validação documental/regulatória ocorre antes de `status=active`.

## Concurrency e idempotência

Toda função mutável recebe idempotency key. O servidor grava `action_requests` com:

- usuário;
- nome da ação;
- hash do payload canônico;
- resultado final.

Se uma requisição repetir por timeout/retry, o servidor devolve o resultado já produzido. Se a mesma chave vier com payload diferente, retorna conflito.

Pedidos usam `version` para optimistic concurrency. Uma ação baseada em versão antiga deve falhar e obrigar o cliente a recarregar o estado.

## Realtime

No piloto de São Gabriel, o frontend pode assinar `orders` e `order_events` via Postgres Changes porque o volume inicial é pequeno e a configuração é simples. Se o produto crescer, migramos a entrega de eventos para Broadcast privado sem mudar a autoridade transacional do banco.

## Ledger financeiro

O saldo não é uma coluna mutável. Ele é derivado das entradas imutáveis por `bucket`:

- `cashback`: crédito para novas compras;
- `commission_pending`: comissão ainda sujeita a validação/cooldown;
- `commission_available`: comissão apta a saque quando Pix real estiver habilitado.

Movimentos de saída são negativos; entradas são positivas. Saque futuro é `commission_withdrawal`. Reversões possuem tipos próprios e nunca apagam histórico.

## Segurança

- publishable key pode existir no frontend;
- secret/service key jamais pode existir no GitHub Pages;
- RLS continua habilitado mesmo com Edge Functions;
- funções server-side validam JWT antes de usar privilégios elevados;
- nenhum dado de outra revenda deve ser retornado por erro, log ou payload;
- endereço do cliente só é entregue à revenda após o pedido estar atribuído;
- logs não devem registrar PIN, token, JWT ou endereço completo.
