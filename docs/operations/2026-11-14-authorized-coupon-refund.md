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

## Resultado real — estorno confirmado

Em **14/11/2026 às 20h55 de Brasília** (23h55 UTC), a operação privada
respondeu HTTP 200 com `refundConfirmed=true`,
`providerRefundVerified=true`, `providerPostAttempted=true`,
`amountCents=890`, `cancelledCoupons=3` e `status=refunded`.
Essa confirmação veio de um novo GET autenticado da ordem no Mercado Pago
após o único POST, validado pelo verificador canônico; o retorno do POST
isolado não foi utilizado como prova.

Consulta independente ao banco confirmou fatura `refunded` com
`refunded_at=2026-11-14T23:55:34.967435Z`, protocolo original `refunded`,
exatamente três cupons `void` e zero usos históricos. A reserva de patrocínio
de R$ 15 passou a `released` pelo trigger original, sem saldo reservado
remanescente para esses cupons.

A segunda execução de conferência, às **20h56 de Brasília**, retornou
HTTP 200 com os mesmos resultados e **`providerPostAttempted=false`**.
Releitura do banco preservou o horário do estorno e as contagens originais.
Não houve nova cobrança, novo cupom nem segundo POST de devolução.

A consulta dos outros módulos preservou plano Essencial com R$ 19,90
disponíveis e zero reservado, publicidade com pagamento de R$ 19,90
`payment_approved` e campanha `active`. Somente a compra de cupons de
R$ 8,90 foi devolvida.

Implementação integrada na [PR #1000](https://github.com/carloskk07/gassg/pull/1000),
merge `acad352e1c0519da64806ef3fcd2dfa7395f7911`.
`payment-reconcile` v5 ACTIVE: os 17 arquivos publicados foram relidos e
comparados integralmente com o bundle aprovado; as 14 dependências anteriores
foram preservadas. Nenhuma migração, sessão de usuário ou aprovação humana
foi fabricada.

Validação do head `ac6e0abd2b16e52920e1a2bf143b2d99381cdcbe`:
[Audit aprovado](https://github.com/carloskk07/gassg/actions/runs/43653666575),
[integração Supabase descartável aprovada](https://github.com/carloskk07/gassg/actions/runs/43653666516)
e [revisão visual aprovada](https://github.com/carloskk07/gassg/actions/runs/43653666510).
Na retomada também passaram as regressões locais de delegação, prova de
estorno e recuperação das cinco famílias de pagamentos.

**Conclusão deste ciclo específico:** compra paga original, devolução integral
confirmada pelo Mercado Pago, cancelamento dos três benefícios, liberação da
reserva e repetição sem novo POST comprovados. O crédito no extrato do banco
do pagador não foi inspecionado. Isso encerra esta homologação específica de
estorno; não comprova resgate comercial de cupons, consumo de tarifa,
mobilidade, pedidos, comissões ou saques. A lista permanece em **13/19
frentes técnicas encerradas e seis abertas**.
