# TAMÃO V1.318 — Validade das evidências financeiras do Mercado Pago Ads

## Por que
Um pagamento já aprovado no livro TAMÃO Ads permanece uma fotografia da última consulta autenticada ao PSP. Sem nova verificação, a apresentação pode se tornar desatualizada. Ausência de notificações não comprova ausência de estornos ou contestação.

## Implementação
- Nova função de consulta `admin_ads_psp_freshness_v1_318` classifica cada checkout registrado, com prioridade para observações de estorno/contestação posteriores à verificação, aprovações com mais de 24 horas sem nova consulta e reservas de checkout bloqueadas há mais de 30 minutos.
- Priorização secundária para demonstrativos vencidos sem comprovação, aprovação observada em webhooks ainda não conciliada e aprovações com mais de 6 horas desde a conferência.
- As últimas notificações são **observações históricas**, não estados atuais do PSP. Inclui data real da última consulta do pagamento, referência, vencimento e links de rechecagem para o administrador principal.
- Novo fluxo SQL `admin_ads_psp_refresh_v1_318`: depois de consultar autenticadamente `GET /v1/payments/{id}`, quando o pagamento **continua** `approved` + `accredited` com ID, titularidade, referência, moeda BRL e valor integral exatos, registra nova data de verificação e versão auditável, sem gerar cobrança ou alterar aprovação. A operação é estritamente `superadmin`, idempotente por request UUID, com bloqueio otimista de versão.
- Quando o PSP informa `refunded`, `charged_back` ou estorno parcial, o fluxo existente V1.314.1 permanece encarregado de registrar a reversão após nova comprovação. Não há promoção automática para pago.
- Admin → Ativações → **Conferências vencidas e cobranças que exigem atenção**. A lista contém no máximo 50 itens mais prioritários e contadores globais.

## Segurança e limitações
- Tabelas financeiras existentes mantidas com RLS. As novas funções são `SECURITY DEFINER`, limitadas a `service_role`, com controle de papéis tanto SQL quanto Edge.
- Nenhuma credencial é enviada ao navegador. O Edge verifica `ADS_MP_CHECKOUT_ENABLED`, token, seller ID e `/users/me` antes da consulta específica do pagamento.
- A nova função de leitura não altera dinheiro, receita, histórico de pedidos, créditos, campanhas ou controles de publicação.
- Não existe agendamento ou conciliação automática nesta versão. A evidência expira novamente com a passagem do tempo; ela **não** prova liquidação irreversível.
- Reservas travadas são destacadas para investigação, **não** refeitas ou apagadas automaticamente, prevenindo checkouts duplicados. A conferência de uma reversão já anotada continuará exigindo fluxo futuro específico se houver nova divergência.
- Sem criação de pagamentos fictícios ou de preferências de produção. Se a conta TAMÃO Ads estiver desabilitada, os controles de rechecagem financeira permanecem bloqueados.

## Arquivos
- Migração: `supabase/migrations/20261016120000_ads_psp_freshness_v1_318.sql`
- API `supabase/functions/admin-ops/index.ts`
- Interface `js/admin-activations.js`, estilos `css/components.css`
- CI `tests/ads-psp-freshness-v1-318.mjs` e regressão `tests/admin-activations-v1-307.mjs`
