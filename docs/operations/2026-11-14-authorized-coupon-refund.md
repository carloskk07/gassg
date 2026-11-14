# Estorno específico autorizado pelo titular — 14/11/2026

O titular respondeu **“autorizo”** à proposta de devolver a compra original de
**R$ 8,90**, cancelando os **três cupons não utilizados de R$ 5**. Esta é uma
delegação explícita ao assistente; não é um clique autenticado no portal.

Escopo fixo da operação privada:

- Fatura: `9af683aa-1064-4999-8809-0c92e565a1b5`.
- Ordem original: `ORD01M730R9E7NNNCWHWFG8JG4AYJ`.
- Pagamento original: `PAY01M730R9EF8XZM1B02SXVGPDWB`.
- Protocolo/idempotência: `36da5f30-c211-4940-a97e-f554b51a3ff9`.
- Total: 890 centavos; três cupons intactos, sem histórico de uso.
- Prazo para iniciar movimentação: até `2026-11-15T01:00:00Z`.

A rota explícita em `payment-reconcile` exige a autenticação privada já usada
pelo cron e não aceita parâmetros financeiros do chamador. O cron normal não
a executa. O token Mercado Pago permanece no ambiente do servidor.

O módulo utiliza o protocolo original `clube_coupon_refund_request_v1_814`,
que bloqueia novos usos sob o lock original da fatura. Somente a criação
inédita desse protocolo pode iniciar um POST. Toda repetição passa a apenas
consultar o provedor, inclusive se a resposta do POST tiver sido perdida.
Também há a chave de idempotência original no Mercado Pago.

Antes de movimentar dinheiro, a conta, referência, moeda, total, Pix, IDs,
quantidade/valor dos cupons e histórico integral de uso precisam coincidir.
Somente GET independente com devolução integral comprovada permite chamar
`clube_coupon_paid_payment_refund`, o resolvedor financeiro existente. A
resposta final ainda exige fatura/protocolo estornados e exatamente três
cupons `void` em consultas posteriores. Não se atribui uma aprovação a um
usuário autenticado artificialmente e não se cria um segundo motor financeiro.

Os testes cobrem conta/valor/ordem divergentes, sandbox, validade, exposição
anterior ou concorrente, resposta ambígua, repetição sem novo POST e falha de
persistência. Os casos são simulados localmente; não constituem estorno real.

Estado deste registro: implementação em validação, execução real ainda não
realizada. Atualizar com a prova efetiva após execução; não declarar crédito
na conta bancária do comprador a partir de um estado local do TAMÃO.
