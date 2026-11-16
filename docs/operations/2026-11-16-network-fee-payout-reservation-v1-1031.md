# TAMÃO #493 — Rede V1.1031: reservas contábeis antes de saque

## Entrega de engenharia

A migração `20261116012000_network_fee_payout_reservations_v1_1031.sql` cria reservas rastreáveis contra **parcelas elegíveis** do fundo dos pacotes de taxa reduzida (10% do NET reconciliado). Cada reserva distribui sua quantia em microcentavos por fonte e por membro; rejeita excessos e tem chave de idempotência global. Cancelamentos liberam disponibilidade sem apagar o histórico. A reversão posterior de uma fonte gera revisão automática da reserva, inclusive se o cancelamento for solicitado.

- Apenas Superadmin, via Edge autenticada (a escrita não é pública). Financeiro tem somente visão agregada.
- Cada reserva usa bloqueio transacional por usuário e soma das alocações anteriores; nenhuma carteira de comissão direta, cashback ou cupons é usada.
- A tela Admin — Rede informa total de reservas e revisões, sem dados pessoais de beneficiários.
- `network_fee_payout_status_v1_1031` consulta o saldo individual e evita exibir centavos fracionários.
- Testes SQL em PostgreSQL descartável (ROLLBACK): ACL, apuração não aprovada, reserva, repetição, dupla reserva, cancelamento e estorno. Contrato JS em Audit.
- **Não** existem beneficiários de Pix cadastrados, envio ao PSP, prova de identidade, conciliação bancária de saída ou saques ativados nesta versão.

## Limites que não podem ser ocultados

**Reserva não significa pagamento.** `payouts_enabled=false` permanece constitucionalmente bloqueado por CHECK da V1.1030. O módulo não contém POST /v1/payouts nem altera a conta bancária. Se o PSP autorizar Payouts em produção, o passo seguinte será vincular beneficiário verificado, assinaturas de produção, envio com idempotência persistida, recuperação de erros ambíguos, GET verificado, prova independente de destino, conciliação e reversões depois da saída. NUNCA transformar `status=success/accredited` isolado em prova suficiente de destinatário.

Para habilitar distribuição aos participantes, o programa ainda exige termos juridicamente aprovados e transparência da elegibilidade, pois participação baseada em atividade diária e receitas pode implicar revisão jurídica e tributária. A apuração de receitas novas segue desligada até autorização via Admin.

## Aceite e status

Esta PR fecha **a parte de reservas e recuperação interna** da #12, não a execução financeira externa. Mantém **18/19 frentes inteiras encerradas** até que o executor de payouts e a prova de beneficiário sejam implementados e testados. A ausência de participantes reais ou de um Pix futuro **não** é pendência técnica; a ausência de execução bancária implementada continua sendo lacuna real.

Pré-merge: `Audit` e `isolated-supabase-integration`. Sem transações reais, identidade falsa em produção ou ligações de PSP.