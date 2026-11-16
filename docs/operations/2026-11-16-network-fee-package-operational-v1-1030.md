# TAMÃO #493 — Rede operacional V1.1030: 10% dos pacotes de taxas

## O que está integrado

A Rede não é mais somente o simulador de 10% da PR #1025. Esta entrega conecta as **fontes de recebimento NET já conciliadas** ao **controle separado de participação**.

- **Revenda:** fonte existente `merchant_billing_provider_charges` + pedido aprovado `merchant_billing_payment_requests` + crédito efetivamente lançado em `merchant_fee_credit_ledger` + registro NET independente `platform_receipt_net_audit`. Só `request_kind='package_purchase'` com plano `billing_mode='prepaid_credit'` e aplicação automática verificada; nunca a taxa da venda do lojista ou boleto genérico.
- **Moto/carro:** `mobility_fee_pix_invoices_v1_837` com `invoice_kind='prepaid_credit'`, lote realmente criado `mobility_fee_prepaid_lots_v1_838`, NET independente e status pago. Não inclui cupons, publicidade ou corridas sem pacote.
- **Participantes:** registro explícito de uma visita à seção Rede por usuário autenticado e conta permanente, contato confirmado e sem bloqueio, usando o horário do banco. O Cliente usa `customer-summary` com `networkVisit:true`, a revenda usa `merchant-ops/growth-network`. Um usuário conta uma vez por fechamento; recarregar uma aba ou renovar o token não gera saldo.
- **Janela:** dia de São Paulo da venda, com distribuição calculada pelos usuários verificados nas 24h anteriores ao fechamento diário. O sistema aguarda o fechamento do dia e prova NET antes da atribuição.
- **Rateio:** 10% da receita líquida do PSP para cada fonte elegível; repasse geral com até 2 pontos percentuais **DENTRO** desses mesmos 10% ao indicador de uma revenda. Indicação válida precisa de CNPJ/empresa aprovada e revisão de identidade `verified_identity`, além de indicador independente, ativo na janela e que não seja membro da própria revenda indicada. Pacotes de moto/carro destinam 10% integralmente ao rateio geral; bônus de revenda não participa.
- **Centavos:** cálculos em microcentavos; por pacote, as parcelas são distribuídas integralmente, inclusive o resíduo fracionário de cada divisão, sem superar os 10%. O painel monetário mostra apenas centavos inteiros, arredondados **para baixo**; frações permanecem registradas.
- **Financeiro:** obrigações são `pending` até os créditos do pacote terem sido **integralmente utilizados** e transcorrido no mínimo sete dias, sem estornos, contestação ou ajuste contábil incompatível. São `eligible` apenas depois. Reversões tiram todo o lote do estado elegível; histórico não é apagado.
- **Extratos:** cada cliente ou proprietário/gerente da revenda vê **só a própria conta**; Admin Financeiro vê somatórios, divergências e fontes; o Superadmin pode habilitar futuras apurações **somente com referência documentada dos termos aprovados**. Todo o motor é isolado do `wallet_entries` e não promete saque.
- **Execução:** rotina SQL `network_fee_package_tick_v1_1030()`, agendada a cada 30 minutos em instalação com `pg_cron`; exclusão de duplicidade por chaves `(kind,source_id)` e `(kind,source_id,user_id)` mais bloqueio transacional.
- **Segurança:** política inicia `accrual_enabled=false`; cron não concede nada antes de aprovação explícita. `payouts_enabled=false` forçado pelo banco. Nenhum clique de participante aciona Pix ou libera dinheiro.
- **Ensaios:** teste estrutural em Audit e teste SQL real no banco descartável, com usuários, revenda, Pix/credenciamento sintéticos, dados NET marcados como **sintéticos**, janela de visita, no duplicate, conta falsa/admin rejeitada, RLS, aprovação com termos e estorno, tudo `ROLLBACK`. Não é prova bancária.

## Como habilitar no momento adequado

No Admin → Crescimento → Benefícios e indicações → Pacotes de taxas reduzidas, clique em **Conferir valores**. O sistema deve indicar conservação contábil sem divergências. O Superadmin informa **referência real da versão publicada e aprovada dos termos** e aciona **Ativar apuração para vendas futuras**. As compras anteriores à ativação permanecem fora do novo programa; suspender interrompe novas apurações sem apagar o histórico.

As telas da Rede mostram claramente valores **em apuração**, **validados sem saque** e fontes. Nenhum valor é creditado nas comissões diretas ou cashback.

## Limites declarados / próximas exigências de saque

Este PR não envia transferências Pix: a integração Mercado Pago Payouts disponível no projeto é observacional/GET. O programa de participação e sua obrigação contábil passam a ter backend e extratos, mas a execução de saque com identificação do beneficiário, disponibilidade da função do PSP, conciliação da saída e falhas/reversões **continua um escopo financeiro separado**. Não afirmar dinheiro pago ou automaticamente sacável.

Regras legais/termos e base de cálculo devem ser conferidos antes de habilitar. Usuários não podem ser obrigados a comprar pacotes, revender ou recrutar para participar. O valor de recibos de pacotes continua representando também **serviços de taxa pré-pagos**, e não lucro livre no dia do Pix.

**Contagem:** continua **18/19 frentes** até que a #12 tenha saída/pagamento formalmente concluídos. Isto não é pendência de trazer um cliente/revenda real.
