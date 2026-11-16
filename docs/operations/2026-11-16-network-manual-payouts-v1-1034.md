# TAMÃO V1.1034 — Saques manuais no início, prazo de 3 dias

## Regra operacional estabelecida

- **Não há saque automático** nesta fase. O proprietário efetua o Pix por um aplicativo bancário externo e registra a prova no Admin. O executor Mercado Pago Payouts V1.1033 fica tecnicamente disponível, mas não é utilizado pelo fluxo manual e continua com execução bloqueada em produção.
- O participante pode solicitar o saque do **saldo validado e disponível**, depois de atingir o mínimo. Só contam fontes de bonificação da Rede V1.1030 efetivamente elegíveis; nenhuma venda de saldo entre participantes, bônus pendente, cupom, cashback ou soma de valores reservados entra no pedido.
- **Valor mínimo de saque NÃO foi definido pelo proprietário.** O campo `network_manual_payout_policy_v1_1034.minimum_cents` começa em `NULL` e impede solicitações até o proprietário escolher uma opção no Admin. As sugestões de faixa na interface não autorizam automaticamente qualquer valor.
- O pedido é inicialmente `requested`; não há prazo prometido enquanto a identidade/chave Pix e o saldo ainda estão em conferência. O Admin somente aprova após verificar beneficiário da V1.1033, saldo não revertido e reserva exclusiva.
- **A aprovação inicia o prazo de até três dias corridos (72 horas)**. A data `due_at` é registrada no servidor como `approved_at + interval '3 days'` e exibida ao participante e ao Admin. A fila prioriza saques a vencer e destaca vencidos. Esta versão não promete dias úteis e não estende o prazo automaticamente.
- Após pagar de fato no banco, o superadmin registra a referência bancária única, arquivo do comprovante SHA-256, valor exato e hash do CPF do destinatário verificado. O original precisa ser mantido para auditoria. **Um registro manual com hash não é verificação automática bancária por API.** A interface usa a nomenclatura *pagamento manual conferido* e nunca afirma que o TAMÃO enviou o Pix.
- Pedido `requested` pode ser cancelado com confirmação de que não houve pagamento, liberando a reserva. Depois da aprovação, não há cancelamento que libere saldo sem conciliação externa; estornos de fontes passam a `review`.
- Como a solicitação trava os mesmos microcentavos usados pelo abatimento V1.1032 e saques externos V1.1033, não há duplicidade de recompensas. O gatilho impede que uma reserva manual gere um segundo job de execução automática.
- O usuário consulta sua própria solicitação e o último status de pagamento, nunca a identidade ou saldo de terceiros.

## Implementação

- Migração `20261116050000_network_manual_payout_3days_v1_1034.sql`: política, ledger de solicitações com SLA imutável, reservas por fonte em microcentavos, autorização exclusivamente de serviço, mudança de estado com prova bancária, cancelamento seguro e gatilhos de exclusividade/reversão.
- Função `network-payout-ops`: ações de cliente `manual-status` e `manual-request` com JWT autenticado; ações `manual-queue`, `manual-set-minimum`, `manual-approve`, `manual-paid`, `manual-cancel` somente para superadmin. A função nunca aceita um `userId` arbitrário nos endpoints do participante.
- `js/growth.js`: consulta e solicitação de saque junto à Rede. `js/admin-network-payout.js`: painel de saques manuais primeiro, mínimo por seleção, fila e prova SHA-256.
- CI: `node tests/network-manual-payout-contract-v1-1034.mjs` e `tests/sql/network-manual-payout-3days-v1-1034.sql` em PostgreSQL descartável com ROLLBACK. Testa limite não definido, contas permanentes, duplicidade, idempotência, autorização, data, CPF, comprovante, reversão e ausência de Pix automático.

## O que não significa

A implantação de software e testes sintéticos não constituem homologação de pagamento bancário real ou autorização dos termos de participação. A ativação do programa V1.1030 continua submetida à aprovação de termos, controle de receita e consentimento do proprietário. Nenhum Pix real é iniciado por esta funcionalidade. **Escolher o mínimo no Admin é a única parametrização comercial ainda não especificada nesta decisão**; não impedir usuários reais de entrar no TAMÃO por isso, mas impedir saques antes do valor estar definido.
