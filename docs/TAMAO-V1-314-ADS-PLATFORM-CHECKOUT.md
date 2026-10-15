# TAMÃO V1.314 — Checkout Pro exclusivo de publicidade e reconciliação pelo provedor

## Novo fluxo
- A partir do instrumento V1.312 com aceite bilateral e demonstrativo V1.313 efetivamente emitido, o fundador pode gerar um checkout **na conta da empresa que opera o TAMÃO** — não na conta de uma revenda.
- O serviço exige `ADS_MP_CHECKOUT_ENABLED=true`, `ADS_MP_ACCESS_TOKEN` de produção com prefixo APP_USR e `ADS_MP_SELLER_ID` da mesma empresa, separados de `MERCADOPAGO_ACCESS_TOKEN` e de qualquer credencial OAuth de revenda.
- **Antes de cada ação financeira**, o Edge valida a identidade do titular da credencial no Mercado Livre (`GET /users/me`) e exige correspondência exata ao seller ID configurado. Sem isso, nenhuma chamada para criar preferência ou consultar pagamento é autorizada.
- O fundador cria o checkout pelo Admin → Ativações → Mercado Pago exclusivo do TAMÃO Ads. Primeiro uma transação SQL atômica reserva a referência única vinculada ao contrato (SHA-256), demonstrativo, moeda, valor e revenda. Depois a API Checkout Pro `POST /checkout/preferences` recebe esses valores e disponibiliza `init_point` HTTPS de domínio Mercado Pago. O retorno é validado e anexado à reserva em uma segunda transação.
- Revenda titular ou gerente consulta o próprio checkout no portal, podendo abrir o checkout hospedado no Mercado Pago. Links para outros domínios, cobranças de outras revendas e chamadas diretas ao SQL são bloqueados.
- Após pagamento, **somente o fundador** confere um identificador numérico real de pagamento usando a API autenticada `GET /v1/payments/{id}`. A aprovação exige `approved` + `accredited`, mesmo ID e mesma referência externa, mesma conta recebedora, moeda BRL e o mesmo valor integral em centavos.
- Reconsulta de `refunded` ou `charged_back` altera o status para `payment_reversed`. A aprovação é sempre uma fotografia do provedor no momento da consulta, sujeita a posterior estorno ou contestação; não deve ser anunciada como receita irreversível.
- Toda transição de reserva, checkout, aprovação ou reversão possui papel superadmin e double authorization no Edge/SQL, controle concorrente por versão, idempotência por UUID, log privado e auditoria.

## Bloqueios seguros e trabalho restante
- **Nenhuma preferência é criada** enquanto não existirem credenciais exclusivas da operadora e habilitação expressa nas variáveis seguras do Supabase. Esta versão não configura segredos, não inventa conta recebedora e não realiza transações reais ao publicar código.
- Uma reserva sem confirmação do Mercado Pago fica bloqueada para nova geração automática. Isso evita cobranças duplicadas diante de falha de rede, mas exigirá uma rotina segura de busca/recuperação da preferência em uma atualização posterior.
- A confirmação é **por consulta autenticada solicitada pelo administrador**, não por redirecionamento do navegador, texto digitado pelo comerciante ou webhook. **Notificação automática e reconciliação recorrente ainda não foram implementadas**. Não existe prova de recebimento quando o servidor não consegue consultar o provedor.
- A integração não emite nota fiscal e não atualiza `merchant_billing_*`, taxas, repasses, créditos, Clube, rede, pedidos ou carteira do lojista. Não utiliza chave de pagamento empresarial dos comerciantes.
- Esta versão não altera `ads_placement_controls_v1_236` nem ativa campanhas públicas, mesmo quando um pagamento está aprovado. Exibição, comprovação de entrega, cancelamento financeiro ou chargeback após publicação deverão ter fluxo próprio e condições comerciais revisadas.
- Nenhuma revenda, contrato, recebível ou pagamento fictício é criado por testes ou implantação.

## Configuração operacional necessária
1. Provisione uma conta comercial Mercado Pago da pessoa jurídica titular da receita Ads, com cadastro e obrigações fiscais adequadas.
2. Guarde na configuração privada das Edge Functions `ADS_MP_ACCESS_TOKEN`, `ADS_MP_SELLER_ID` e `ADS_MP_CHECKOUT_ENABLED`. A flag deve ficar desativada até que a titularidade e o fluxo financeiro estejam efetivamente homologados.
3. Não reutilize as credenciais da cobrança de créditos de taxas das revendas.
4. Verifique em Admin → Ativações → Mercado Pago exclusivo do TAMÃO Ads. Qualquer ausência de configuração aparece como bloqueio real e não como checkout ativo.

## Evidências de implementação
- Migração `supabase/migrations/20261016080000_ads_platform_psp_v1_314.sql`
- Edge Functions `admin-ops`, `merchant-ops`, biblioteca compartilhada `_shared/mercadopago.js`
- Teste de segurança `tests/ads-platform-psp-v1-314.mjs`, mais regressão da Central de Ativações e auditoria global.
