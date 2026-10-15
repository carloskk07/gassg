# TAMÃO V1.313 — Cobranças internas de publicidade, sem receitas presumidas

## Implantação funcional
- Os demonstrativos de **TAMÃO Ads** são completamente separados de `merchant_billing_*` (taxas, créditos, débitos de pedidos e provedores das revendas).
- **Pré-requisito**: documento V1.312 em status `bilateral_accepted`, usuário fundador confirmado e integridade SHA-256 do documento revalidada no banco; preço e dias de vencimento são copiados do documento eletrônico congelado.
- Admin principal pode **preparar** um demonstrativo interno, **emitir** o demonstrativo comercial para a revenda e **cancelar** um demonstrativo pendente, com confirmação explícita, motivo, versão e audit trail.
- Vencimento: calculado em dias corridos a partir da data local de emissão em America/Sao_Paulo, no prazo acordado no documento. Valores sempre BRL, inteiros em centavos.
- A revenda vê somente suas próprias cobranças emitidas ou canceladas. O titular pode informar uma referência de pagamento para **conferência posterior**; gerente consulta, sem registrar referências.
- Cada referência informada é tratada **exclusivamente como alegação não verificada**. Nenhuma ação transforma o demonstrativo em pago, em faturamento recebido, ou habilita campanha.
- Segurança: tabelas privadas RLS, sem grants a anon/authenticated, RPCs somente para service_role com checagem independente do papel no PostgreSQL e controle JWT no Edge, controle otimista de versão e request UUID idempotente. Log administrativo registra emissão/cancelamento sem fingir liquidação.

## O que esta versão não faz
- **Não cria cobranças PSP**, QR Code, Pix, link de pagamento, boleto, nota fiscal, checkout ou webhooks.
- **Não há estado 'paid'**, portanto não existe confirmação manual/falsa de recebimento.
- **Não faz conciliação com bancos/provedores**. A arquitetura separada deixa esse trabalho explícito para a próxima versão, após escolher e homologar um PSP que receba em nome da empresa operadora do TAMÃO.
- **Não publica Ads** nem modifica o controle global de publicação, cidades, Clube, bonificações, comissões e rede.
- A emissão do demonstrativo não equivale à emissão de documento fiscal. A plataforma deve observar as obrigações tributárias aplicáveis antes da cobrança efetiva.
- Sem possibilidade de reemitir automaticamente documento cancelado; novos ciclos e estornos exigirão rotinas próprias auditadas.

## Interfaces
- Admin → Ativações → Cobranças de publicidade TAMÃO Ads
- Portal Revendas → Vender mais e ampliar sua rede → Cobrança de publicidade
- Teste `node tests/ads-receivables-v1-313.mjs`
- Migração `supabase/migrations/20261016070000_ads_receivables_v1_313.sql`
