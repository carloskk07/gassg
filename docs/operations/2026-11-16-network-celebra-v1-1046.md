# TAMÃO V1.1046 — TAMÃO Celebra: campanhas festivas com orçamento fechado

## Experiência para participantes
- Rede TAMÃO reconhece participação real com conquistas verificadas. O extrato por origem da V1.1045 continua sendo a verdade financeira.
- A seção sazonal **só aparece ao participante quando o Superadmin tiver autorizado efetivamente a campanha**. Não divulgar benefícios não financiados/ativos, nem textos de piloto.
- Cartões festivos simples e acessíveis: "Natal que aproxima" e "Ano Novo, novas conexões", com período, limite por pessoa, regra de receita e estado real. CTA de convite só quando a campanha estiver dentro da janela elegível.
- Um participante que já tenha um bônus especial validado verá o total da ocasião, separadamente do saldo da carteira e do fundo coletivo. Seu extrato registra o lançamento e eventual estorno.
- Jamais prometer pagamento por visita à página, cadastro isolado, mais de um nível de convite ou número de contatos. Não usar linguagem de renda passiva ou ganho diário garantido.

## Calendário proposto, inicial OFF
| Campanha | Janela São Paulo | Bônus incremental | Teto sugerido para autorização | Limite individual |
| --- | --- | --- | --- | --- |
| Natal que aproxima 2026 | 20 a 27 dezembro 2026 | Até +1 p.p. do NET | R$ 50 | R$ 2 |
| Ano Novo, novas conexões 2027 | 29 dezembro 2026 a 4 janeiro 2027 | Até +1 p.p. do NET | R$ 50 | R$ 2 |

Estes são **modelos preparados**, não campanhas publicadas, autorizadas ou financiadas. Ambos começam `enabled=false`, `budget_limit_cents=0`, `spent_cents=0`, sem termos. O administrador escolhe com um seletor o teto de R$ 20 / R$ 50 / R$ 100, informa referência real dos termos aprovados, confirma e pode suspender. O teto limita despesa contabilizada, **não comprova depósito ou disponibilidade financeira na conta bancária**.

## Condições financeiras
1. Só existe bônus depois de um **primeiro benefício direto ou publicidade existente e já validado**: Moto/Carro (pacote pré-pago consumido integralmente com NET conciliado), Clube **financiado por revenda** e **publicidade primeira campanha paga**. Profissional indicado pode participar quando sua primeira campanha de publicidade válida for paga. Não remunerar caronas gratuitas, cupons subsidiados pelo TAMÃO ou simples cadastros.
2. Adicional separado de **até 1% do NET**, limitado a R$ 2 por participante por campanha e ao teto total autorizado. Uma concessão por usuário e por ocasião. Sem comissão recorrente e sem remuneração multinível.
3. Se fundo de pacotes (10%), prêmio direto (até 5%) e Natal (+1%) estiverem simultaneamente habilitados, o custo desses incentivos no pacote de Moto/Carro pode alcançar **16% do NET**, antes de PSP, tributos e outros custos. A aprovação financeira deve avaliar margem real.
4. O evento de origem precisa ocorrer **depois da autorização e dentro da janela da campanha**. A conferência pode ocorrer após o fim do evento, dentro de uma janela máxima de 45 dias; não existe retroatividade para compras prévias. Se o orçamento for atingido, nenhuma recompensa adicional é criada.
5. Estornos verificados **revertem o bônus e liberam o teto**, mesmo se a campanha tiver sido suspensa ou encerrada. Repetir uma solicitação não duplica valores.
6. Bônus sazonal é uma **trilha segregada sem saque, abatimento, Pix ou crédito de compra**. A conciliação de saldo e o módulo de saque existentes não são alterados nesta versão. Dinheiro nunca é movimentado na ativação.
7. Segurança: RLS nas tabelas, todas as RPCs fechadas para anon/authenticated, chamadas com service_role só por Edge autenticado, Superadmin exclusivo para habilitar/suspender e leitura permitida ao Financeiro. Evita vazamento entre contas.

## Provas e implantação
- Contratos JS: `tests/network-celebra-v1-1046.mjs`
- PostgreSQL completo descartável: `tests/sql/network-celebra-v1-1046.sql` com rollback (campanhas OFF, sem saldo, ACL, termos, uma recompensa NET, replay, teto total, reversão após suspensão).
- `customer-summary` atualiza apenas quando o usuário visita explicitamente a Rede, não ao abrir o extrato. `admin-ops` dá acesso apenas aos papéis permitidos.
- Validação de build, performance, visual, publicação e três portais; a ativação comercial/financeira exige autorização posterior.

## Próximos formatos — não implementados nesta fase
- Aniversário da plataforma: data precisa ser formalmente definida, sem inventar aniversário.
- Datas regionais/temáticas: oferecer cartões de reconhecimento e comunicação positiva; qualquer valor financeiro deve ter fonte de receita, orçamento e aprovação específicos.
- Descontos de parceiros no Clube: dependem de contrato real do parceiro e estoque/serviço elegível; nunca presumir patrocínio do TAMÃO.
