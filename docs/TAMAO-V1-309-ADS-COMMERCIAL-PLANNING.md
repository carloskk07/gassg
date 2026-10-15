# TAMÃO V1.309 — Carteira interna de propostas comerciais Ads

## Escopo entregue

- O administrador principal registra **planos internos para peças aprovadas**: orçamento previsto em centavos, duração de 7 a 90 dias, etapa da negociação e observação.
- Estados: `draft` (em elaboração), `ready_for_contact` (preparado para abordagem, não enviado), `paused` (pausado), `closed_lost` (encerrado sem venda). Não existe estado “ativo”, “contratado”, “pago” ou “publicado”.
- Leitura autorizada: superadmin/operations/readonly. Escrita: somente superadmin ativo; confirmada novamente pelo PostgreSQL.
- Uma peça somente é elegível enquanto `merchant_ads_campaigns_v1_233.status='approved_creative'`, `ads_live=false`, `no_charge=true`, na mesma versão. O banco bloqueia edição de peças retiradas ou versões alteradas.
- RLS + revogação de privilégios diretos de usuários, além de operações exclusivamente pelo papel `service_role`.
- Atualização por versão esperada com `FOR UPDATE`; reexecução idempotente por UUID e assinatura imutável.
- Toda alteração efetiva gera evento na `platform_admin_audit`; reenvios idênticos são identificados sem reaplicar a alteração.
- Painel móvel com formulário individual e leitura posterior para comprovar o registro.

## Limites intencionais

Este recurso **não** notifica revendas, publica anúncios, gera impressões, cria checkout, cobra, assina contratos, autoriza cidade ou movimenta dinheiro. `ready_for_contact` é tarefa interna, não confirmação de envio. Valores são **orçamentos comerciais potenciais**, nunca receita recebida.

Não foram inventados dados de campanhas anteriores. Sem peças aprovadas, o painel exibe um caminho para revisão de criativos e nenhum valor de faturamento.

## Deploy e verificação

1. Banco: `supabase/migrations/20261016030000_ads_sales_planning_v1_309.sql`.
2. Serviço: atualizar `admin-ops` com código do mesmo commit, preservando `verify_jwt=false` com validação interna do token.
3. Confirmar tabela com RLS e EXECUTE de funções apenas a `service_role`.
4. Executar `node tests/admin-ads-sales-planning-v1-309.mjs`, auditoria geral, build e publicação dos três portais.
5. Não criar planos de teste usando revendas reais. Testes positivos são realizados com estado isolado e verificações estruturais; nenhum orçamento foi declarado contratado.
