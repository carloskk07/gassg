# TAMÃO — Supabase backend v1.9.0

Backend multiusuário do TAMÃO São Gabriel, isolado em projeto Supabase próprio.

## Princípios de autoridade

- Cliente pode iniciar com **Anonymous Auth**.
- Revenda usa identidade permanente.
- Administração usa identidade permanente + allowlist explícita em `platform_admins`.
- Cliente anônimo pode vincular e-mail posteriormente sem trocar o `user_id`.
- Publishable key pode existir no frontend.
- Secret/service role nunca existe no navegador.
- O browser **não possui SELECT direto nas tabelas da aplicação**.
- RLS permanece habilitado como defesa adicional, mas o data-plane do piloto é server-only.
- Privilégios padrão de objetos futuros em `public` falham fechados para `anon/authenticated`, incluindo `MAINTAIN` do PostgreSQL 17.
- Sequências públicas já existentes também são explicitamente fechadas para `anon/authenticated`.
- Todas as projeções e mutações reais passam por Edge Functions autenticadas.
- Valores monetários usam centavos inteiros; preço unitário de catálogo/snapshot é limitado a 1.000.000 centavos para manter a maior cesta suportada dentro de `int4`.
- Ledger financeiro é append-only com idempotency key.
- Estados de pedido e estado financeiro são separados.

## Por que o browser não lê tabelas diretamente

Mesmo leitura direta criava superfícies desnecessárias:

- enumeração de revendas e catálogo;
- endereço do cliente antes da necessidade operacional;
- ledger financeiro linha a linha;
- dependência de policies complexas para Anonymous Auth;
- risco de regressão ao adicionar uma coluna sensível.

O navegador recebe apenas projeções mínimas por Edge Function.

## Primeiro parceiro piloto

`pilot_partner_drafts` guarda interesse comercial antes do cadastro jurídico real. É uma tabela server-only e não participa de `market_supply_status()`, matching ou criação de pedidos.

O primeiro registro atual é **Gas e Lenheira do JR**, P13 com faixa entregue confirmada de **R$ 115,90 mínimo / R$ 120,00 normal / R$ 125,00 máximo**, `price_status=confirmed` e `onboarding_status=awaiting_legal_data`. O staging continua fora de matching e não cria merchant ativo.

Conversão para operação real continua exigindo o fluxo normal: identidade permanente, aplicação/cadastro, CNPJ, compliance aplicável, catálogo real, taxa/ETA, heartbeat e ativação administrativa.

`merchant_offer_load(uuid[])` fornece ao servidor apenas carga ativa e volume de pedidos dos últimos 7 dias. Esses sinais não são expostos como identidade ou score interno ao cliente e só desempatem parceiros próximos em valor ao consumidor.

## Política de preço por SKU

`catalog_items.price_cents` continua sendo o **preço normal/preferencial**.

Campos adicionais:

- `pricing_mode`: `fixed` ou `range`;
- `min_price_cents`: piso autorizado;
- `max_price_cents`: teto autorizado;
- `pricing_strategy`: `volume`, `balanced` ou `margin`.

Em `fixed`, mínimo = normal = máximo.

Em `range`, `get-offers` calcula um preço efetivo usando apenas sinais do próprio merchant. O preço de outras revendas não entra nessa função. O resultado precisa estar dentro da faixa; `create_quote_snapshot` revalida a autorização, freshness e estoque sob lock antes de congelar `quote_items.unit_price_cents`.

## Fluxo do cliente

1. `signInAnonymously()`.
2. `get-offers` recebe endereço + cesta.
3. Servidor filtra revendas elegíveis.
4. `create_quote_snapshot` revalida preço/estoque e cria quote atômica.
5. Cliente escolhe quote opaca.
6. `create-order` cria pedido em transação idempotente.
7. `get-order` devolve projeção segura.
8. `customer-action` trata cancelamento/requote.
9. `customer-summary` devolve saldos agregados + código de indicação + referência mínima do pedido ativo para recuperação após falha de conexão.
10. Cliente pode converter a conta anônima em permanente via `auth.updateUser({email})`.

O runtime atual usa polling protegido em vez de assinatura direta de tabelas.

## Fluxo da revenda

1. Operador abre `?merchant=1#merchant`.
2. Login passwordless por e-mail.
3. Edge Function exige usuário permanente.
4. `merchant-orders` valida `merchant_members`.
5. Somente `owner/manager/operator` operam no piloto.
6. `driver` permanece bloqueado até assignment por pedido.
7. Antes do aceite, endereço completo é oculto.
8. Aceite reserva estoque.
9. `dispatch` cria PIN e autoriza “A caminho”.
10. `arriving` confirma aproximação.
11. `complete-delivery` exige pagamento confirmado + PIN.

## Control plane administrativo

1. Admin abre `?admin=1#admin`.
2. Login passwordless não cria novas contas automaticamente.
3. `admin-ops` valida JWT, identidade permanente e allowlist `platform_admins`.
4. Aprovação da aplicação cria/vincula merchant como `pending`, nunca online.
5. `merchant_compliance` registra CNPJ e ANP.
6. Trigger impede merchant `active/online` sem CNPJ verificado.
7. Se qualquer GLP P1–P90 estiver ativo, ANP vigente precisa estar `verified`.
8. Admin concilia receivables, reembolso de cashback e ajustes.
9. Reversão financeira + admin audit ocorrem na mesma transação.
10. O primeiro administrador pode ser reservado por **hash SHA-256 do e-mail**; a promoção só ocorre quando existir usuário Auth permanente e com e-mail confirmado.

Enquanto o piloto usa GitHub Pages, sessões de revenda/admin usam `sessionStorage` por aba. Antes de escalar acessos privilegiados, usar origem dedicada/custom domain para não compartilhar o origin `carloskk07.github.io` com outros projetos.

## Rescue

`merchant_fail_before_dispatch` recompõe estoque reservado e chama `system_rescue_order`.

Toda troca de fornecedor:

- usa a cesta congelada;
- revalida estoque/atividade;
- congela preços e taxa;
- não aumenta preço silenciosamente;
- usa `REQUOTE_REQUIRED` quando necessário.

## Financeiro

### Cashback

Cashback é crédito fechado para compras futuras.

Ao ganhar cashback:
- o custo entra no orçamento daquele pedido;
- o ledger registra `cashback_earn`.

Ao usar cashback:
- `cashback_reserve` consome o saldo;
- cliente paga `gross - cashback`;
- revenda mantém direito ao valor bruto;
- `merchant_cashback_reimbursements` registra quanto a plataforma deve repassar à revenda.

### Referral

- relação nova só nasce antes do primeiro pedido;
- autoindicação é proibida;
- pagamento nasce somente em settlement válido;
- comissão fica em `commission_pending`;
- só amadurece depois do hold e quando o referrer é identidade permanente;
- reversão estorna pending/available sem apagar histórico.

### Receita da plataforma

Cada pedido congela:

- taxa da plataforma;
- reserva de custo variável;
- contribuição mínima;
- cashback;
- referral;
- hold.

A identidade financeira do reward grant garante:

`platform fee = variable reserve + cashback + referral + platform contribution`

A contribuição nunca pode ficar abaixo do piso configurado.

## Reversão pós-venda

`reverse_settled_order_financials` é server-only e idempotente.

Ela não apaga a entrega. Em vez disso:

- mantém `status=SETTLED`;
- muda `financial_state` para `reversed`;
- estorna cashback;
- estorna comissão;
- reverte taxa da plataforma;
- cria ajustes se dinheiro já tiver sido liquidado;
- reverte/reconcilia reembolso de cashback à revenda.

## Jobs

- `chama-order-watchdog`
- `chama-reward-retry`
- `chama-settlement-accounting-retry`
- `chama-reward-maturation`
- `chama-data-retention`
- `chama-anonymous-cleanup`
- `chama-compliance-expiry`
- `chama-first-admin-bootstrap`

A limpeza de Anonymous Auth exige idade mínima e ausência total de histórico de negócio.

## Auth que precisa ser verificado no dashboard

Antes do primeiro E2E real:

- Anonymous Sign-Ins habilitado;
- Site URL/Redirect URL do GitHub Pages;
- Manual Linking habilitado para upgrade anônimo → permanente;
- entrega de e-mail funcionando para magic link/confirmação;
- conta permanente do primeiro administrador criada e e-mail confirmado; quando existir uma reserva server-only correspondente, o job `chama-first-admin-bootstrap` conclui a inclusão em `platform_admins` automaticamente.

## Regras inegociáveis

- nenhuma secret key no frontend;
- nenhum acesso direto às tabelas ou sequências pelo browser;
- nenhuma função privilegiada executável por `anon/authenticated`;
- nenhuma recompensa sem settlement;
- nenhuma comissão sacável para identidade anônima;
- nenhum aumento de preço sem novo aceite;
- nenhuma conclusão apenas por ação de UI;
- nenhuma identidade de revenda antes do aceite;
- nenhum driver operando pedido sem assignment individual;
- nenhuma ativação de revenda sem CNPJ verificado;
- nenhum P13 em merchant ativo sem ANP verificada;
- nenhuma autoelevação administrativa.
