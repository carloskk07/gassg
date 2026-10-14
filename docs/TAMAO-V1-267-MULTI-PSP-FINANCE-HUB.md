# TAMÃO V1.267 — Central multibanco e multi-PSP

## Objetivo
Exibir, no mesmo painel de controle, **duas vias financeiras distintas** sem misturar evidências, proprietários do dinheiro, verbas ou conclusões:
1. **Recebimentos dos clientes pelas revendas**: pagamentos cujo dono dos recursos é a revenda, verificados por prestadores configurados pela própria revenda. Base: \`payment_provider_catalog\`, \`merchant_sale_payment_attempts\` e \`merchant_sale_payment_verifications\`.
2. **Benefícios financiados pelo TAMÃO**: declarações do administrador de pagamentos externos de comissões de indicação. Bases: \`platform_referral_payout_claims_v1_263\`, \`platform_referral_payout_voids_v1_263\`, \`platform_referral_payout_proofs_v1_264\` e última consulta a \`platform_referral_provider_observations_v1_265\`.

**Nenhum repasse é executado**, nenhuma comissão liberada e nenhuma compensação entre essas duas vias é permitida. Uma venda recebida pela revenda jamais constitui evidência de desembolso do TAMÃO.

## Via de pagamentos das revendas
A central carrega o catálogo existente de PSPs (atualmente 11 opções, incluindo modo manual) com os atributos que a plataforma **declara**: método de conexão, recursos de lookup/webhook, status de adaptação, verificação e fluxo destinado à revenda. Esses atributos *não* provam conta conectada ou operação efetiva.

Para o mês, apresenta:
- \`paymentAttempts\`: número de tentativas realizadas.
- \`evidenceRecords\`: número de registros de evidências de pagamento.
- \`providerVerifiedOrders\`: pedidos distintos com registros \`status='verified'\`, \`verification_level='provider'\`, \`evidence_type in ('provider_api','provider_webhook')\` e \`funds_owner='merchant'\`. Isso comprova apenas a trilha documental do banco interno, não liquidação de saques da plataforma.
- \`merchantEvidenceRecords\` global inclui os registros; \`merchantProviderVerifiedOrders\` global conta pedidos distintos sem duplicidade. A soma por PSP pode ser superior ao total global se um pedido tiver evidências de dois provedores distintos; não somar como receitas únicas.

## Via de benefícios do TAMÃO
A central cobre exatamente os quatro tipos de provedor existentes no registro de declarações:
- \`mercado_pago\`: adaptador oficial **somente GET** para consultar transação de saída (V1.265), se a credencial específica e a habilitação do produto Payouts estiverem disponíveis.
- \`pix\`: **sem integração bancária de saídas**.
- \`bank_transfer\`: **sem integração bancária de saídas**.
- \`other\`: **sem integração oficial de saídas**.

Para cada classe, informa o número de declarações, as ativas e retificadas, os documentos anexados, quantas tiveram uma consulta oficial à transferência e quantas ainda têm o status/referência/valor coincidentes na **última** consulta.

\`ownerDeclaredActiveCents\` representa **valor declarado pelo fundador**, não liquidação, saldo bancário ou custo de caixa confirmado.

O endpoint \`admin-ops\` inclui \`outgoingPayoutsCredentialConfigured\`, obtido da existência de \`MERCADOPAGO_PAYOUTS_READ_ACCESS_TOKEN\`. Mesmo \`true\` significa apenas **presença do segredo**, não permissão do provedor ou resultado positivo de consulta. Nunca reutilizar credenciais de checkout ou recebimentos da revenda para consultar repasses externos do TAMÃO.

## Autorização
- Migração \`supabase/migrations/20261014235956_multi_psp_finance_hub_v1_267.sql\`.
- Função de agregação \`platform_multi_psp_private_v1_267.report\` em schema privado, \`SECURITY DEFINER\`, com checagem explícita de \`platform_admins.active\` e função \`superadmin\` ou \`finance\`.
- Wrapper \`public.admin_owner_multi_psp_hub_v1_267\`, \`SECURITY INVOKER\`, \`EXECUTE\` somente \`service_role\`. Os perfis \`anon\` e \`authenticated\` não podem executar a RPC diretamente.
- Edge \`admin-ops\`: ação \`owner-multi-psp-hub\` com autorização de admin, validação de esquema, limite e invariantes; resposta contém exclusivamente agregações por provedor.
- UI \`js/admin-acquisition.js\`: seções separadas e isoladas por sessão, sem exposição de identificadores de transação individuais, CPF, chaves Pix, extratos ou credenciais.

## O que não foi resolvido
A API GET de Mercado Pago Payouts **não disponibiliza uma prova de titularidade da conta de destino confrontável com o indicador cadastrado**. Assim:
- \`recipientVerified=false\`
- \`bankSettlementVerified=false\`
- \`externalPaidBenefitsCents=null\`
- \`merchantReceiptsProvePlatformPayouts=false\`
- \`merchantAndPlatformFundsNettingAllowed=false\`

Essas limitações são exibidas de forma explícita e não apenas registradas em documentação.

## Próximos passos operacionais
1. Obter acesso oficial a um provedor ou instituição bancária com APIs **específicas de transferências de saída**, com consulta autenticada de beneficiário e conciliação verificável.
2. Especificar o modelo de identidade mínima: usar identificadores do PSP/banco, sem exibir ou armazenar chaves Pix/CPF em páginas públicas.
3. Implementar o adaptador oficial de consulta para **cada** provedor após validar escopo OAuth, contrato de resposta, callback de estorno, autenticação e permissões; nunca declarar implementação apenas porque a empresa consta no catálogo de recebimentos.
4. Revalidar o fluxo com uma transferência real autorizada. **Não criar transações fictícias em produção** para forçar o status de sucesso.

## Testes
\`tests/owner-multi-psp-hub-v1-267.mjs\` exige a separação de vias, os invariantes de valores/contagens, a não execução de transferências, o bloqueio de conclusões bancárias e a proteção por função/sessão. A consulta no Supabase é feita sobre os registros reais; ausência de transações retorna zeros sem simular comprovação.
