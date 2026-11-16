# TAMÃO V1.1032 — abatimento de bonificações validadas em pacotes de taxas

## Objetivo e exclusões
A revenda pode usar **bonificações próprias, já elegíveis e verificadas** da distribuição de pacotes de taxas para abater uma parcela de uma **nova compra pré-paga**. O restante continua sendo cobrado em Pix pelo mesmo provedor e pelo mecanismo de conciliação já homologado. Não é saque, carteira de transferências, troca entre participantes, compra e venda de créditos, nem pagamento declarado por administradores.

O abatimento não está habilitado enquanto o programa V1.1030 não tiver termos formalmente aprovados e `accrual_enabled=true`. Migração e interface **não acionam este switch**; o padrão de produção permanece desabilitado e nenhum valor é criado artificialmente.

## Fluxo concreto
1. Proprietário ou gerente autenticado abre Financeiro > Opções de taxa e clica **Usar bonificações**.
2. `merchant-ops` consulta `network_fee_offset_status_v1_1032`, que calcula `eligible` menos reservas bancárias e abatimentos anteriores. Nunca considera bônus pendentes/revertidos nem cupons e cashback.
3. O usuário confirma um valor limitado ao saldo disponível e ao preço do pacote menos **R$ 1,00**, preservando um Pix externo verificável.
4. `network_fee_offset_prepare_v1_1032` cria de forma transacional um pedido de pacote com `expected_amount_cents` reduzido e aloca a parte interna contra fontes de bônus elegíveis. `idempotency_key`, locks por usuário/merchant e alocação em microcentavos evitam reuso.
5. A própria rota existente `merchant-billing-pix` gera o QR só do saldo restante; o backend e o readback exigem esse mesmo valor. O crédito de taxas e a ativação continuam dependendo da confirmação **exata** do Pix pelo PSP, vinculada a uma origem real. Sem Pix confirmado, não há crédito nem ativação.
6. O banco confere `preço do pacote = Pix recebido + bonificação aplicada`, com trigger impedindo a aprovação manual do saldo abatido.
7. Se o pedido for cancelado antes de um recebimento bancário, a bonificação reservada volta a ficar disponível; caso haja recebimento, não existe cancelamento silencioso.
8. Fonte revertida, estorno ou refund sinalizam revisão; se o pacote já tiver sido liberado, a revenda entra em bloqueio de novas vendas para conciliação. Não se inventa estorno Pix.

## Conservação e contabilidade
- A mesma origem não pode ser reservada para saque **e** compra de pacote; ambas contabilizam as alocações em `network_fee_package_offset_allocations_v1_1032` e `network_fee_payout_allocations_v1_1031`.
- A regra de distribuição dos 10% continua baseada somente em receitas líquidas **externas**, através de `network_fee_package_tick_v1_1030`. A parcela abatida com bônus não constitui novo recebimento do provedor.
- Aprovação: somente conciliação Pix externa; registro do desconto e comprovante Pix permanecem vinculados ao `paymentRequestId`. `RLS` protege as novas tabelas; `anon`/`authenticated` não executam RPCs financeiras.
- Esta versão cobre **pacotes pré-pagos de revendas**. Moto/carro e outros produtos não utilizam o desconto automaticamente, pois têm rotas de pagamento diferentes.

## Testes
`node tests/network-fee-package-offset-contract-v1-1032.mjs` verifica a camada JS, os gates e o vínculo com CI. `tests/sql/network-fee-package-offset-v1-1032.sql` roda em PostgreSQL descartável dentro de `BEGIN; ... ROLLBACK;`: permissões, termos, pagamento Pix parcial confirmado, conta não duplicada, repetição idempotente, cancelamento e estorno sem movimentação de dinheiro real.

## Publicação e riscos controlados
A migração deve ser aplicada após CI de PostgreSQL e JS ter passado. Em Supabase, implantar `merchant-ops` mantendo suas dependências e regras de autenticação. Não ativar remuneração, saque ou vendas reais com base apenas nos testes sintéticos. A executor bancário de saída ainda é frente independente e não foi substituído por esta funcionalidade.
