# TAMÃO — homologação comercial verificável, 01/11/2026

**Autoridade:** issue #493, `main` no início desta análise `3dbe77a24e9e3ca08a14a4ced60a48c48b7636d0`. Este arquivo é uma matriz de evidências e critérios de aceite, não uma autorização para ativar vendas. Não substituir `docs/TAMAO_EXECUCAO.md`, `platform_launch_readiness()`, os controles de PSP ou os fluxos administrativos existentes.

## Fotografia de produção — leitura direta, não teste sintético

Consulta Supabase às 10h49–10h53 (horário de Brasília), 01/11/2026:
- Supabase: `ACTIVE_HEALTHY` PostgreSQL 17.
- Portais Cliente, Parceiro, Admin no SHA oficial; reatestado via GitHub OIDC em 01/11/2026 13:51:05 UTC, `portalsFresh=true` na releitura e `securityBlockers=[]`. O atestado expira; nunca reusar a fotografia como autorização futura.
- `operationMode=PRELAUNCH`, `commerceEnabled=false`, `readyToEnable=false`, `offerReadyMerchantCount=0`.
- **Há 1 revenda já cadastrada, porém pendente de aprovação e offline**; 3 itens ativos com preço e estoque e 3 meios de pagamento ativos já configurados para ela. `merchant_business_details=0`; nenhuma revenda é elegível segundo o servidor. Os indicadores `ownerReadyMerchantCount=0` e `paymentReadyMerchantCount=0` contam SOMENTE revendas elegíveis; não provam ausência de vínculo de owner ou de meios configurados. Não pedir cadastro de nova revenda nem duplicar métodos sem evidência.
- `orders=0`, `public_requests=0`, `support_cases=0`, `merchant_sale_payment_attempts=0`, `merchant_billing_payment_events=0`, `merchant_billing_payment_refunds=0`, `merchant_cashback_reimbursements=0`, `clube_coupon_paid_invoices=0`, `mobility_requests=0`, `discovery_listings=0`. Há 1 solicitação de cobrança de crédito, **não** equivale a receita confirmada.
- Laboratório financeiro: 1 Pix real de **R$ 2,00** emitido em 27/10 e 1 evento de webhook posterior com `paymentStatus=processed` e `providerProcessed=true`. O laboratório é separado dos saldos comerciais; a confirmação do PSP não prova crédito bancário líquido, reembolso, repasse ou conciliação.
- Os 28 avisos `authenticated_security_definer_function_executable` do Advisor exigem revisão individual; testes com JWT real no Supabase descartável cobrem isolamento de RPCs de descoberta/mobilidade. Um aviso isolado não prova exploração. Não revogar ACLs indiscriminadamente.

## Matriz única de homologação

Legenda: **TEC** = evidência automatizada isolada; **PROD** = evidência efetiva de operação real. Aprovação em TEC nunca preenche PROD automaticamente.

| Módulo | Evidência TEC disponível (executar do commit candidato) | Evidência PROD obrigatória antes de declarar homologado |
|---|---|---|
| Portal Cliente + checkout | Audit + Build; `tests/isolated-supabase-positive-checkout.mjs`; `tests/customer-checkout-ambiguous-recovery.mjs` | CEP real autorizado, cotação com preço/estoque da revenda habilitada, pedido criado uma vez, status correto para cliente |
| Revenda, catálogo e gestão | `tests/isolated-supabase-commerce-smoke.mjs`, `tests/merchant-order-quick-queue-v1-174.mjs` | Comprovação legítima de elegibilidade, owner, catálogo/estoque/preço/taxa e aceite/rejeição de pedido legítimo |
| Entrega e motorista offline | `tests/merchant-offline-delivery.mjs`, `tests/browser-driver-offline.mjs`, workflow Android quando executado | Dispositivo físico autenticado, perda de sinal, PIN/recebimento legítimo, reconexão, versão e estado final coincidentes entre Cliente/Parceiro/Admin; jamais marcar como entregue só com comprovante local |
| Pix/Cobranças de revenda e Admin | `tests/admin-financial-live-pix.mjs`, `tests/remote-finance-psp-readiness.mjs`, `tests/mercadopago-platform-billing-dual-status.mjs` | Charge única autorizada, QR/BR code correto, confirmação do PSP + webhook assinado + evidência bancária líquida + vínculo à cobrança correta no Admin. Um Pix de laboratório não atende |
| Cupons pagos/descontos/cashback | `tests/isolated-supabase-coupon-full-schema.mjs`, `tests/coupon-atomic-checkout-contract.mjs`, `tests/financial-cashback-reimbursement-replay-v1-331.mjs` | Fatura e recebimento próprio confirmados, emissão única, uso único/reserva e desfazimento, custo de desconto identificado, cashback com lastro e saldo consistente sem antecipar crédito |
| Indicações/comissões/saques | `tests/isolated-referral-payout-lifecycle.mjs`, `tests/financial-invariants-fuzz.mjs` | Origem de receita legítima, regras autorizadas, maturação sem duplicidade, prova de saldo, saque/repasse com referência bancária e estorno consistente |
| Estornos/reconciliação | `tests/isolated-refund-provider-anchor-audit.mjs`, `tests/financial-reversal-adjustment-integrity-v1-332.mjs` | Estorno real identificado pelo PSP e conta, reversão atômica de benefícios/comissões e valor líquido reconciliado; divergências não silenciosas |
| Ajuda/reportar erro | `tests/isolated-support-positive-journey.mjs`, `tests/support-http-handler-journey-v1-493.mjs` | Solicitação legítima de teste explicitamente marcada e consentida, protocolo, visibilidade protegida no Admin, triagem, conclusão e privacidade; chegada automática à IA **não foi comprovada** |
| Profissionais, caronas, hospedagens e moto/carro | `tests/isolated-discovery-privileged-rpc.mjs`, `tests/mobility-tracking-security.mjs`, `tests/discovery-public-journeys.mjs` | Contas verificadas, anúncios autênticos revisados, autorização, contato/solicitação, GPS somente do motorista/viagem autorizados, proteção de documentos; nenhuma listagem foi publicada |
| Admin, segurança e publicação | `tests/isolated-launch-security-fingerprint.mjs`, `tests/remote-direct-payment-kill-switch.mjs`, workflow `launch-readiness.yml` | Roles reais, portais no SHA da `main`, Turnstile, eventos e logs íntegros, autorizações explícitas; sem alterar RLS ou toggles para fazer indicador ficar verde |

## Ordem de ensaio sem risco e critérios de parada

1. **Preservar controles:** manter PRELAUNCH e `commerceEnabled=false` até existirem autenticação, autorização e parceiro elegível reais. Nunca preencher CNPJ, ANP, representação, dados bancários, pagamentos ou estoque com informações fictícias na produção.
2. **Regressão técnica em infraestrutura descartável:** usar exclusivamente os workflows existentes **Audit**, **TAMÃO isolated Supabase integration**, **Build**, **public visual smoke**, **launch readiness** e **Cloudflare reconcile**. Eles testam casos negativos, idempotência, permissões, pagamentos sintéticos e integridade, mas não comprovam liquidação de produção.
3. **Preparar a revenda já existente, sem captar outra:** identificar o que realmente falta na revenda pendente (documentos/representação e validações de conformidade), preservar owner e pagamentos já configurados, reconfirmar preço, estoque, taxa e disponibilidade quando apropriado. Não aprovar cadastros sem evidência verdadeira.
4. **Checagem financeira independente:** separar o Pix de laboratório dos recebíveis TAMÃO. Confirmar PSP ativo no ambiente correto, conta beneficiária, QR, pedido, retorno assinado, valor líquido e identidade da cobrança. Um `processed` isolado não autoriza créditos.
5. **Ensaiar fluxo comercial legítimo sob controle:** somente com elegibilidade e permissão válidas, confirmar preço → compra única → aceite/rejeição → entrega/PIN → recebimento → conciliação → estorno, comparando as três visões e o PSP. Registrar resultado/horário/referências *sem publicar dados pessoais em GitHub*.
6. **Homologar módulos financeiros individualmente:** cupons, cashback, afiliados, repasses, estornos e patrocínios não podem herdar o selo de um Pix pago ou de um pedido com dinheiro na entrega.
7. **Encerramento:** classificar cada linha como `TEC_APROVADO`, `PROD_PENDENTE`, `PROD_COMPROVADO` ou `BLOQUEADO` com data, executor e artefatos redigidos. Sem prova, continua pendente. Revalidar gates antes de ativar a operação.

## Onde encontrar as evidências

- GitHub Actions: `https://github.com/carloskk07/gassg/actions`, incluindo a integração descartável [#41301454105](https://github.com/carloskk07/gassg/actions/runs/41301454105) (01/11, sucesso) e o atestado OIDC automático do portal pelo workflow `launch-readiness.yml`.
- Operação comercial: Admin → Central de produção e roteiro; a função autoritativa é `public.platform_launch_readiness()`, que informa pendências e **conta somente revendas elegíveis**.
- Financeiro: Admin → Laboratório Financeiro e diagnóstico de cobranças, recebíveis e provedor; procurar a emissão prévia antes de emitir outra. Não repetir Pix por suposição.
- Suporte: Admin → Erros e pedidos de ajuda; protocolo e histórico do endpoint `submit-public-request`, sem exposição de PII em issues.
- Código de execução e dependências: `docs/TAMAO_EXECUCAO.md`, issue #493, `docs/release-authority.md`.

**Não fazer:** desbloquear comércio para testar checkout, reclassificar webhook de laboratório como receita de revenda, converter comissões sintéticas em saldo, apagar estornos, inventar aprovações, remover advertências críticas em lugar de corrigir problemas ou declarar 100% comercial pelos testes de CI.
