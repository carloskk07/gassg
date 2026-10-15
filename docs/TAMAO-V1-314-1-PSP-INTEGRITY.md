# TAMÃO V1.314.1 — Integridade da cobrança e da prova do Mercado Pago

## Finalidade
Complementa a V1.314 já publicada, sem recriar cobrança, sem alterar clientes, sem gerar checkout novo e sem tocar nas taxas/créditos das revendas.

1. **Documento financeiro imutável:** impede alteração posterior de revenda, versão, SHA-256, valor, referência externa, provedor, conta recebedora, preferência e pagamento de uma reserva de Ads.
2. **Resposta incompleta é rejeitada:** atributos obrigatórios do provedor são comparados com `IS DISTINCT FROM` e status nulo não pode virar pagamento aprovado.
3. **Reembolso parcial é conservador:** `approved/partially_refunded`, `refunded` e `charged_back` retiram o estado de pagamento totalmente aprovado, após nova consulta autenticada ao provedor.
4. **Preferência verificada:** o Edge compara `collector_id`, moeda BRL, único item, quantidade 1, valor em centavos e `external_reference` com a reserva gravada.
5. **Idempotência por referência comercial:** a chave de envio ao provedor deriva da referência estável da cobrança. Uma reserva incompleta nunca é reemitida automaticamente no painel.

## Operação real
- Configuração explícita e protegida no Supabase: `ADS_MP_CHECKOUT_ENABLED=true`, `ADS_MP_ACCESS_TOKEN` específico da empresa operadora do TAMÃO e `ADS_MP_SELLER_ID` correspondente.
- Sem esses segredos ou se a conta não conferir com a API do provedor, nenhuma preferência é criada. Nunca copiar credenciais das revendas.
- O módulo continua **sem webhook exclusivo e sem conciliação automática periódica**. A confirmação de pagamento e eventual estorno depende de uma consulta à API do Mercado Pago autorizada pelo superadmin. Uma transação antes aprovada pode ser contestada posteriormente.
- `adsLive=false` permanece obrigatório: nenhum pagamento ou clique de checkout publica automaticamente anúncios.
- Não foram gerados exemplos de pagamentos reais nem valores fictícios em produção.

## Implantação
A nova migração `20261016090000_ads_psp_hardening_v1_314_1.sql` redefine apenas a função de registro da prova financeira e instala o gatilho de imutabilidade, preservando a migração original da V1.314. A função `admin-ops` recebe as verificações adicionais. O teste `ads-platform-psp-v1-314.mjs` foi ampliado.
