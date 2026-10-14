# TAMÃO V1.244 — Financiamento inicial do proprietário e comunicação pública

## Objetivo
O fundador informou que pretende assumir inicialmente os custos de cashback,
comissões e benefícios. A partir desta versão, o Admin possui quatro centros
independentes para planejamento mensal (cashback, indicação de cliente, indicação
de revenda e cupons). O valor planejado é custeio **interno** da operação.

## Controle de responsabilidade
- Orçamento mensal e teto individual em centavos; sem valor presumido.
- Só superadmin grava e registra compromisso interno com valor positivo.
- Finanças apenas consulta. A gravação exige versão esperada, UUID idempotente
  e auditoria por ator.
- Planejamento **não é depósito**, nem reserva, saldo ou comprovante. A versão
  não habilita novos tipos de recompensa, não cria créditos, não efetua saques.
- Os programas de cashback e indicação de cliente que já possuem política
  financeira própria continuam regidos pelas regras existentes de compra
  qualificada, validação, antifraude, reversão e conciliação.
- Indicação de revenda e pacotes do Clube, ainda não ativos, permanecem
  bloqueados até cobertura do benefício e fluxo de pagamento comprovados.
- O fato de o proprietário custear não significa que o saldo exista no PSP.
  Conciliar um aporte real e habilitar uma nova campanha exigirá etapa
  operacional separada, com registros verificáveis e limites transacionais.

## Comunicação
- Home destaca comparação, rede de indicações e autonomia do cliente.
- Clube e Rede usam mensagens convidativas, explicam o cálculo da primeira
  compra elegível e expõem saldos reais.
- A página de marcas e patrocinadores apresenta propostas reais de negociação,
  sem publicar anúncios fictícios ou inventar campanhas ativas.
- Avisos operacionais de teste/sistema ficam na área interna; o visitante
  encontra as condições relevantes junto à ação correspondente.
- Não foram criados depoimentos, métricas de sucesso, revendas, ofertas ou
  descontos fictícios.
