# TAMÃO V1.246 — Evidências de aportes do fundador

## Escopo
O TAMÃO recebe somente **declarações e referências externas** de transferências que
o fundador realizou. A aplicação não recebe dinheiro, não consulta automaticamente
contas bancárias e não mantém imagens de comprovantes; a referência da operação e a
referência independente do extrato precisam ser confrontadas fora da plataforma.

### Fluxo
1. O superadmin define um plano de custeio mensal positivo por categoria na V1.244.
2. Financeiro ou superadmin pode **declarar** uma transferência já feita, com
   data (até 90 dias), valor, finalidade, ID da operação no banco e observação.
3. O registro ganha UUID e passa a `pending_review`. ID bancário único global
   evita que o mesmo identificador seja apresentado para categorias diferentes.
4. Outro administrador financeiro, necessariamente diferente do declarante,
   confronta o comprovante com o extrato e informa referência independente de
   confirmação para classificar `manual_reconciled`, ou recusa (`rejected`).
   Registros conciliados podem posteriormente ficar `disputed`.
5. Cada ato registra o usuário, versão, pedido UUID e assinatura idempotente;
   versão antiga, pessoa não habilitada e segunda tentativa discordante são
   rejeitadas. A declaração exige plano atual em `internally_committed`.

### Limites críticos
- `manual_reconciled` = **conferência humana interna**, não confirmação via
  API bancária, dinheiro disponível, receita da plataforma, saldo contábil ou
  autorização automática para despesas.
- Mesmo com revisão, o retorno servidor contém `bankApiConfirmed=false`,
  `fundsSpendable=false`, `newBenefitsEnabled=false`, `cashMoved=false`.
  A tabela tem checks `funds_spendable=false`, `coupons_enabled=false`,
  `payouts_enabled=false` para evitar habilitar dinheiro por engano.
- Painel mostra o valor **declarado** e, separadamente, o **conferido
  manualmente**. Disponível para gastar é sempre R$0 nesta versão.
- Política vigente de cashback e de comissão por cliente não foi modificada.
  Clube TAMÃO e incentivo por novas revendas não foram ativados.
- Não existe upload de comprovantes nem custódia de recursos nesta fase;
  o usuário deve conservar os documentos originais em local seguro.
- Usuário não pode fabricar registros para teste em produção, tampouco alterar
  dados diretos pelo Data API (RLS e permissões revogadas).

### Evolução posterior
Integração de extrato/transações do PSP/banco no titular correto, vinculação de
comprovante retido com autorização de acesso, regra contábil e reserva
transacional atômica por benefício, limite global e reversões, antes de
permitir o uso do dinheiro real. Sem validação externa não chamamos
`manual_reconciled` de depósito confirmado.
