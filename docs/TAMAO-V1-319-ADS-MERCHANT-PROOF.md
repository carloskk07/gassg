# TAMÃO V1.319 — Acompanhamento verificável de pagamentos de publicidade pela revenda

## Mudança prática
A página **Vender mais e ampliar sua rede → Comprovação e validade do pagamento** passa a distinguir o valor no livro do TAMÃO do **momento em que o Mercado Pago foi realmente consultado**. Não existe promessa de quitação irreversível.

O titular ou gerente da revenda visualiza exclusivamente o registro de seu estabelecimento, incluindo horário da última consulta autenticada, idade da evidência em horas e, quando existir, data do último evento assinado coletado pelo servidor. A consulta nunca acessa a API do PSP por iniciativa do navegador nem altera o pagamento.

A classificação é feita no PostgreSQL: sem checkout, checkout em preparação, aguardando confirmação, aprovação observada ainda sem conciliação, aprovado na última consulta (até 6h), reconferência recomendada (6 a 24h), confirmação desatualizada (mais de 24h), possível estorno observado após a última confirmação ou estorno já registrado.

## Solicitação de reconferência
O **proprietário** pode pedir uma nova consulta administrativa quando uma aprovação está envelhecida ou uma possível reversão foi observada. O gerente pode ler, mas não pode enviar. Uma solicitação não aprova pagamentos. Para evitar repetição abusiva, o servidor exige versão atual do checkout, UUID e limita novas solicitações enquanto um pedido recente sem nova verificação permanece aberto.

No **Admin → Ativações → Pedidos de reconferência de pagamentos**, o superadmin vê as solicitações e pode abrir o fluxo existente de conferência da V1.314/V1.318. A solicitação só passa a ser considerada atendida quando a última consulta autenticada e a versão financeira do servidor ficam posteriores ao pedido. O processo não gera aprovação ou estorno automaticamente.

## Garantias e limitações
- As provas são **retratos temporais** de consultas feitas pelo backend; notificações de webhook são apenas observações históricas, não confirmação atual.
- Proteções por RLS e grants somente para `service_role` nas novas tabelas e RPCs, com checagem de papéis tanto no Edge quanto no PostgreSQL.
- Reversões são tratadas com destaque, sem afirmar automaticamente que o valor foi estornado.
- Nenhuma cobrança, pagamento, liberação de Ads, ajuste de crédito, alteração de pedido, publicação de anúncio ou acionamento de PSP é feito durante as novas operações V1.319.
- Não foram criados registros financeiros artificiais para testar o painel. A demonstração de comportamento é feita por regressão com dados simulados.
- A confirmação de pagamento pode tornar-se obsoleta; **o usuário não deve tratar a visualização como recibo fiscal** ou garantia irreversível.
- A conta do Mercado Pago do TAMÃO Ads permanece sujeita às configurações específicas `ADS_MP_*`, controle administrativo e verificação de recebedor quando uma reconciliação real é requisitada.

## Arquivos
- Migração `supabase/migrations/20261016130000_ads_merchant_proof_v1_319.sql`
- Funções `merchant-ops` / `admin-ops`
- UI `js/merchant.js`, `js/admin-activations.js`, `css/components.css`
- Teste `tests/ads-merchant-proof-v1-319.mjs` e regressão da central V1.307.
