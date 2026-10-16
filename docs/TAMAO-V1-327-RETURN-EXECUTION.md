# TAMÃO V1.327 — Retornos Ads com evidência de nova tentativa

A V1.326 permitia agendar uma nova tentativa após resposta negativa da revenda, mas o histórico não ligava esse agendamento à próxima tentativa declarada.

## Evolução

- Quando o administrador principal registra uma nova tentativa **realmente realizada** pelo formulário já existente de atendimento, uma trigger liga o registro ao retorno previamente agendado, na mesma transação, e altera o estado de `scheduled` para `attempt_recorded`.
- O plano conserva prazo e contato inicial; registra o UUID do contato posterior, data do relato, versão e auditoria, sem editar o relato histórico original.
- Os registros continuam a distinguir **declaração do administrador** de entrega técnica ou confirmação da revenda: um telefonema sem sucesso é somente `not_reached`, nunca uma conversa concluída.
- O novo quadro **Ativações → Retornos vencidos e tentativas registradas** ordena retornos programados e tentativas, identifica atrasos e abre diretamente o formulário existente de atendimento manual da revenda, com checagem da versão e do consentimento atuais.
- O portal da revenda exibe o andamento do último retorno do ciclo ativo, sem mostrar notas internas.
- Novas tentativas somente são vinculadas quando o contexto da solicitação, canal, versão, interesse Ads e estado da revenda continuam válidos.
- RLS e privilégios originais preservados. Novas RPCs só `service_role`, com controle duplo de permissão em Edge e PostgreSQL. Sem alteração de pagamentos ou exibição de anúncios.

## Segurança e limitações

Não existe automação de chamadas, WhatsApp, e-mail ou mensageria; a trigger não cria contatos, apenas vincula um contato que o administrador registrou conscientemente por meio do fluxo autenticado existente. O vínculo é um ato de acompanhamento administrativo, não prova de contato recebido pelo comerciante. O titular poderá avaliar o relato de atendimento no fluxo existente V1.325.

Migração `20261016210000_ads_return_attempts_v1_327.sql`; RPCs `admin_ads_return_execution_read_v1_327` e `merchant_ads_return_execution_v1_327`; teste `ads-return-execution-v1-327.mjs`.
