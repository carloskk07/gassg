# TAMÃO V1.245 — Acompanhamento dos incentivos financiados pela plataforma

## Por que esta evolução

A V1.244 criou centros de planejamento separados para o fundador. A V1.245
adiciona **evidência de créditos de cashback e indicação de cliente realmente
gerados pelo mecanismo existente**. O saldo planejado não é tratado como
depósito ou financiamento disponível.

## Dados e interpretação

- Janela: mês corrente em America/Sao_Paulo, respeitando início e fim do mês.
- Fonte: `public.order_reward_grants`; sem dados sintéticos.
- Por tipo de benefício: total bruto emitido na janela, parcela de créditos
  emitidos nessa janela que foi revertida, valor líquido remanescente dessa
  mesma *coorte de emissão*, teto de planejamento mensal e proporção entre
  emissão bruta e teto proposto.
- Alertas administrativos: teto ainda não definido, emissão superior ao
  planejado, uso de 80% ou mais do teto, emissão dentro do teto.
- A proporção é monitoramento, **não bloqueio automático de pagamento**:
  motores financeiros atuais permanecem intactos e têm seus próprios gates
  de margem, antifraude, liquidação e reversão.
- Comissão gerada e retida não corresponde necessariamente a saque, pagamento
  bancário ou dinheiro já transferido. A RPC não calcula pagamentos externos.
- Para revendas indicadas e cupons ainda sem programas ativos, a emissão
  declarada é zero por ausência de geração nesses mecanismos. Não inventar
  desembolsos ou reservas.

## UX

Os limites do fundador são digitados em **reais (R$)**, com precisão de duas
casas e conversão validada para centavos antes de enviar à Edge Function. A
análise aparece logo acima do planejamento no Admin → Aquisição.

## Autorização

RPC privada `platform_funding_private_v1_245.pulse` e wrapper público
somente para `service_role`, com checagem explícita de superadmin ou finance
ativos, sem acesso de navegador a dados de orçamento ou histórico individual.
Retorna agregados por programa, sem identidade pessoal e sem alterações no
ledger, pedidos, saques ou recompensas.

## Próximas etapas de operação

Antes de permitir que bônus novos debitam custeio do fundador:
conciliação real e comprovante de aporte, limite transacional atômico por
campanha, critérios de elegibilidade, fluxo de reversão, tratamento de estornos
e exposição real do programa. Não tratar limite planejado como dinheiro
disponível. O usuário define os valores e o Admin registra o compromisso.
