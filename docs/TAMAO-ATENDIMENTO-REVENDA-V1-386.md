# TAMÃO V1.386 — Atendimento por pedido da própria revenda

17/10/2026

## Diagnóstico

A central administrativa já processa chamados e a V1.384 mostra o acompanhamento ao cliente, mas a revenda não possuía uma visualização resumida dos problemas vinculados aos seus pedidos. Exibir diretamente dados administrativos ou conceder SELECT sobre `support_cases` ao navegador representaria riscos desnecessários de privacidade e autoridade.

## Solução

**Endpoint existente `merchant-orders`:**

- Autenticação validada por `auth.getUser(token)`, papel operacional verificado e membro ativo vinculado à revenda **antes** de qualquer consulta de chamados.
- Consulta da tabela `support_cases` com dupla restrição, `merchant_id = selected.merchant_id` **e** `order_id IN (IDs dos pedidos ativos já autorizados)`; pedidos apenas oferecidos, ainda sem aceite, não recebem dados de suporte.
- Projeção de campos estritamente necessários: categoria, situação, horário de abertura/atualização. **Não são retornados:** mensagem do cliente, telefone, documentos, notas administrativas, ID do chamado, código de recebimento, nome do atendente ou contato particular.
- Acesso somente a owner, manager e operator na resposta operacional já autorizada. Driver continua na resposta específica para entregador, anterior à consulta, sem projeção de suporte.
- Resposta inclui `supportSummary.version=1` e `scope=merchant-active-orders`, além da lista minimizada `supportCases` por pedido; no máximo 100 registros de suporte retornados na consulta. Erro na consulta impede snapshot enganoso.

**Portal da revenda:**

- Resumo de pendências nos pedidos ativos carregados e cartão recolhível de atendimento dentro do próprio pedido.
- Assuntos e etapas (aberto, em análise, resolvido, encerrado) somente após validação da projeção. Não inclui botões que resolvem ou encerram chamados.
- Oculta a funcionalidade com endpoint antigo ou papel não habilitado, sem declarar falsamente que não há chamados.
- Em logout, mudança de revenda, falha de autorização ou atualização inválida, a projeção de suporte é descartada junto com a lista de pedidos.
- Estilos responsivos e leitores de tela. O painel não depende de tempo real e não promete resolução.

## Segurança e limite operacional

A implementação usa o endpoint com autenticação interna e origin allowlist existentes, sem novas permissões RLS nem exposição de tabelas. Os estados são lidos, nunca alterados. `customer-care` e `admin-ops` permanecem as autoridades sobre abertura, análise e conclusão dos chamados. A lista é limitada a pedidos ativos e até 100 atendimentos; não representa o histórico completo.

A função `merchant-orders` publicada anteriormente possui `verify_jwt=false` (autenticação obrigatória validada explicitamente no handler). Esse parâmetro de implantação deve ser preservado; nunca removê-lo sem testar a autenticação atual. Recomenda-se confirmar a correspondência integral dos arquivos compartilhados e código da função antes do deploy.

## Validação

`tests/merchant-support-scope-v1-386.mjs` no Audit verifica duplo escopo merchant/order, vínculo de membro, isolamento de entregador, exposição mínima, papel, sanitização do HTML, troca de conta e responsividade mobile.

Audit e Build isolated live portals devem passar antes da integração; implantação Edge Function e Cloudflare têm verificações próprias. Não há mudança de preços, estoque, pedidos, comissões, pagamentos, reembolsos ou liberações comerciais.
