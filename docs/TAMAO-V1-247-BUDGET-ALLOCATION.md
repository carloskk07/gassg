# TAMÃO V1.247 — Distribuição atômica do orçamento mensal do fundador

## Entrega
O superadmin agora separa **partes do orçamento mensal planejado** para campanhas de cashback, indicação de clientes, indicação de revendas e Clube. São valores *planejados*, não saldos bancários disponíveis, créditos de consumidores ou benefícios ativados.

- Cada centro tem um teto definido previamente no Admin V1.244, status de compromisso interno e versão.
- Planejamento individual por campanha: categoria, mês (atual e próximos dois), código único, descrição e montante em R$.
- Bloqueio transacional com pg_advisory_xact_lock no nível do centro de custos e mês, somado a única referência por campanha e UUID idempotente. Não permite distribuir mais do que o teto informado mesmo em chamadas concorrentes.
- Histórico imutável de criação/devolução com ator, data, motivo e versão. Devolução restaura **apenas** o orçamento ainda não distribuído.
- Se já houver campanha com valor separado, o banco recusa reduzir o teto para menos que o montante distribuído ou abandonar o estado de orçamento comprometido, mesmo pela ação V1.244.
- Financeiro pode consultar; apenas superadmin separa ou devolve orçamento.

## Segurança
- Tabelas RLS, nenhuma leitura/escrita direta a anon, authenticated e service_role. Serviço chama funções com autorização explícita do superadmin (gravações) e financeiro (consulta).
- Campos CHECK: `spendable=false`, `funds_verified=false`, `coupons_enabled=false`.
- RPCs sempre retornam `spendableCents=0`, `newBenefitsEnabled=false`, `fundsVerified=false`, `plannedOnly=true`.
- Não altera pedidos, pagamentos, créditos ao consumidor, carteira, regras de recompensas nem tabelas de aportes. Nenhum gasto executado.
- A regra não é um substituto de extrato bancário validado, token de dinheiro, passivo real, pagamento Pix, nem controle de resgates.

## Situação prática e próximo salto
Apenas um superadmin está ativo no cadastro administrativo no momento da implementação. A V1.246 exige um **segundo administrador financeiro diferente** para conferir evidências de aportes, de maneira independente; esse requisito é deliberado e não foi relaxado. Sem segundo operador não há dupla conferência manual final.

Para habilitar benefícios novos: confirmar a origem e disponibilidade dos recursos no banco/PSP correto, distinguir reserva financeira real da distribuição planejada, impor débitos e estornos atômicos por benefício/pedido e limitar o risco global por campanha, sempre com idempotência e controle de acesso.

Nota: o cashback e a indicação direta já usam regras financeiras independentes, que esta versão não substitui.
