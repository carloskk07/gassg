# TAMÃO V1.316 — Caixa de entrada de webhooks assinados do Mercado Pago Ads

## Funcionalidade
- A V1.314 cria Checkout Pro independente, a V1.315 descobre pagamentos por referência. A V1.316 acrescenta **recebimento de notificações assinadas de pagamento**, mas **sem promover estado de liquidação automaticamente**.
- Novo endpoint privado de serviço: `/functions/v1/ads-payment-webhook-mercadopago` (o Mercado Pago deve ser explicitamente configurado para enviá-las).
- Pré-condições protegidas no Supabase: `ADS_MP_WEBHOOK_ENABLED=true`, `ADS_MP_WEBHOOK_SECRET` (segredo HMAC da aplicação Ads), `ADS_MP_ACCESS_TOKEN` próprio da empresa TAMÃO Ads e `ADS_MP_SELLER_ID` esperado. Sem elas o endpoint retorna 503; **não reutilizar credenciais de revendas**.
- O endpoint exige POST JSON, limite de 16 KiB, tipo payment, timestamp do provedor na janela de 15 minutos, cabeçalhos `x-signature` e `x-request-id`, verificação HMAC oficial, ID consistente no corpo/query.
- **Prova independente:** antes de gravar, consulta `GET /v1/payments/{id}` com token TAMÃO Ads e exige ID, conta recebedora, referência, BRL e centavos íntegros. O banco cruza a referência, o vendedor, o valor, o estado do checkout e o ID vinculado antes de aceitar o registro.
- Eventos são deduplicados por SHA-256 de ID da requisição e pagamento, sem armazenar token, payload completo, CPF ou dados de cartão. O registro contém apenas metadados mínimos necessários à conferência.
- Painel **Admin → Ativações → Eventos Mercado Pago para conferência**: totais, empresa, ID, estado externo e link de ação para conferir o pagamento. Somente o administrador principal pode iniciar esta conciliação.
- A confirmação final continua fazendo uma **nova consulta autenticada** à API Mercado Pago através de V1.314 e transação controlada por versão. A notificação nunca chama RPC de quitação, não altera saldo ou contas das revendas, nem publica anúncios.

## Limites
- A caixa só funciona após registro manual ou oficial do endpoint webhook na aplicação Mercado Pago da empresa TAMÃO Ads. A ferramenta não altera configurações da conta Mercado Pago nem instala um webhook automaticamente.
- Enquanto não houver conta e segredo configurados, a funcionalidade ficará pronta no código, mas **não operacional para receber notificações**.
- Eventos são indicação para análise, não prova automática de pagamento liquidado; a plataforma poderá precisar de reconciliação mais frequente e gestão de estornos e notificações perdidas.
- Sem campanhas reais, contas, transações ou notificações fictícias criadas nesta versão.
- Função sem JWT porque o Mercado Pago não envia login Supabase: a proteção exige assinatura HMAC válida, timestamp atual e verificação no provedor. Dados ficam privados com RLS, service_role e RPCs protegidos.

## Arquivos
- `supabase/migrations/20261016100000_ads_mp_signed_inbox_v1_316.sql`
- `supabase/functions/ads-payment-webhook-mercadopago/index.ts`
- `supabase/functions/admin-ops/index.ts`, `js/admin-activations.js`
- `tests/ads-mp-signed-inbox-v1-316.mjs`
