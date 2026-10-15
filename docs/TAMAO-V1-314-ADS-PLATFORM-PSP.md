# TAMÃO V1.314 — Checkout Mercado Pago exclusivo do TAMÃO Ads

## Escopo

A V1.314 acrescenta um fluxo de **Checkout Pro** vinculado ao instrumento comercial aceito por ambas as partes (V1.312) e ao demonstrativo emitido (V1.313). Toda operação usa tabelas exclusivas `platform_ads_psp_*`, sem alterar `merchant_billing_*`, contas de pagamento das revendas, taxas, créditos ou pedidos.

No painel Admin → Ativações → Mercado Pago exclusivo do TAMÃO Ads, o superadmin pode solicitar uma preferência do Mercado Pago e, posteriormente, conferir um pagamento por seu ID diretamente na API do provedor. A revenda pode visualizar o link oficial de Checkout Pro em seu painel de crescimento, quando este existir e o demonstrativo estiver vigente.

## Garantias implementadas

- **Conta recebedora própria:** o servidor exige `ADS_MP_CHECKOUT_ENABLED=true`, `ADS_MP_ACCESS_TOKEN` de produção e `ADS_MP_SELLER_ID`. Antes de cada operação, consulta a identidade da conta pela API do Mercado Pago, comparando com o ID configurado. Não usa OAuth dos comerciantes nem a credencial de cobrança de taxas do TAMÃO.
- **Apenas superadmin** inicia uma reserva de checkout e reconcilia pagamentos; a revenda apenas consulta.
- **Reserva transacional antes da chamada externa:** um checkout por revenda e instrumento; idempotência por referência imutável, identificação da preferência e dos dados da conta recebedora. Falha ou resposta ambígua do provedor conserva o estado `reserved` e bloqueia reenvio automático, para não gerar cobranças duplicadas. Recuperação manual segura permanece necessária.
- **Validação de preferência:** ID, URL oficial HTTPS, referência externa, coletor, moeda BRL, quantidade e valor conferidos antes de exibir o link.
- **Pagamento só reconhecido por consulta autenticada** a `/v1/payments/{id}`, confirmando conta recebedora, referência, BRL, valor integral, ID, status `approved` e detalhe `accredited`. Não aceita redirecionamento, link de retorno ou referência digitada pela revenda como confirmação de recebimento.
- **Contestação/estorno:** a consulta de `refunded`, `charged_back` ou `approved/partially_refunded` remove o estado de aprovação do módulo. Esta conciliação é uma *posição verificada na consulta*, não prova de liquidação definitiva ou de ausência de estornos futuros.
- **Sem ativação de anúncios:** `adsLive=false` permanece em todas as respostas e operações. Nenhuma chamada modifica controles de publicação, cidades ou campanhas. Requer avaliação posterior de entrega real, tributos e procedimentos contábeis.
- Tabelas com RLS habilitado, sem `GRANT` a `anon` ou `authenticated`, funções RPC restritas a `service_role`, controles explícitos de papel e versão, registros idempotentes, auditoria e bloqueio de alteração das identidades de cobrança por trigger.

## Fronteiras e pré-requisitos para operação real

Esta versão **não habilita cobranças automaticamente**, não preenche credenciais, não executa pagamentos de teste e não cria exemplos fictícios de receitas. O administrador precisa ter **uma conta jurídica válida do TAMÃO no Mercado Pago**, credenciais próprias e identificação de recebedor conferida. A configuração será feita por segredo protegido do Supabase, fora do repositório. Não reutilizar token de revenda ou tokens genéricos de faturamento.

A V1.314 usa Checkout Pro e **conciliação administrativa sob demanda**, sem webhook Ads dedicado e sem atualização periódica automática. Antes de operar em grande escala, será necessária homologação de webhooks, rastreio de estornos posteriores, reconciliação periódica e tratamento financeiro/fiscal de valores líquidos, taxas e repasses. Não afirmar que pagamentos com status aprovado foram liquidados definitivamente.

Se a chamada externa falhar após a reserva, não gerar outra preferência às cegas: consultar as preferências oficiais do Mercado Pago e confirmar que se trata da mesma referência, conta e valor antes de implementar uma eventual recuperação.

Referência técnica: https://www.mercadopago.com.br/developers/pt/reference/online-payments/checkout-pro-preferences/overview

Migração: `supabase/migrations/20261016080000_ads_platform_psp_v1_314.sql`

Teste: `node tests/ads-platform-psp-v1-314.mjs`.
