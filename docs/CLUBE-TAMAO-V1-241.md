# Clube TAMÃO V1.241 — Central de Campanhas Patrocinadas (NEGOCIAÇÃO)

## Escopo entregue
Apenas revisão comercial e projeção de capacidade com base **nas intenções voluntárias**, não em fundos reais.

### Administração
- Consultar intenções de revendas por cidade/pacote, inclusive as retiradas ou alteradas.
- Calcular custo hipotético da revenda por resgate com **arredondamento para cima**, número teórico de resgates e de pacotes completos que o orçamento sugerido poderia suportar.
- Registrar etapa com justificativa, identidade do operador, versão de origem e histórico:
  - `under_review`: analisando;
  - `request_documents`: falta documentação;
  - `economic_prechecked`: pré-análise econômica, **não é aprovação** (somente finanças/superadmin);
  - `declined`: negociação encerrada.
- Impedir revisão de propostas retiradas, versões desatualizadas e mudanças de cidade de cadastro.
- Atualização concorrente protegida por versão e UUID de idempotência. Verba e demais dados da revenda são copiados do cadastro, nunca arbitrados pelo administrador.

### Invariantes financeiros e jurídicos
- Nenhuma prova de patrocínio, contrato aprovado, campanha ativada ou emissão de cupons.
- Campos financeiros `funding_verified`, `contract_approved` e `campaign_enabled` são **sempre falsos** por CHECK do banco, além de validação no Edge.
- O teto informado é **intenção de orçamento**. Não é verba comprometida, recebida ou garantida.
- O número de pacotes é **ilustrativo**, não estoque de cupons, direito de desconto ou autorização de vendas.
- Sem acesso direto a INSERT/UPDATE/DELETE no Data API para nenhum papel browser, nem para service_role. Rotina privilegiada em schema interno confere Admin ativo e papéis.
- Nenhuma alteração em pedidos, carteira de cashback, cobranças diárias, créditos de taxa, conciliação ou PSP da revenda.
- A fonte de pagamento da mercadoria permanece sempre a revenda.

### Próxima fase necessária antes de abrir vendas
Contratos individualizados e prova de financiamento por revenda/categoria/cidade, conciliação/garantia, registro de passivo dos cupons vendidos, orçamento reservado em transação, controle por pedido e SKU, cancelamento e arrependimento, idempotência de resgates e orçamento mínimo seguro para atendimento do pacote inteiro. A negociação V1.241 **não substitui** essa homologação.

### Casos de teste de cobertura (não são dados reais)
- 3 × R$ 5 em descontos de gás. Revenda indica R$ 30 e 100% de participação => 6 resgates hipotéticos, equivalente a 2 pacotes.
- Revenda com mesmo teto de R$ 30 e 25% de financiamento => 24 resgates / 8 pacotes, **sem** financiar os outros 75%. Essa lacuna precisa de patrocinador/TAMÃO e análise econômica adicional.
- 5 × R$ 2 em água com R$ 30 e 100% => 15 resgates / 3 pacotes, mas a simulação financeira da V1.239 pode demonstrar prejuízo mesmo assim.

Lembrete: nenhum cenário gera receita de fato; margem de pacote, custo do PSP, eventual imposto, custos de atendimento e direitos do consumidor exigem novos testes.
