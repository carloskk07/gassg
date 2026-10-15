# TAMÃO V1.282 — conferência diária das revendas

## Objetivo
Reduzir o esforço para descobrir o que precisa de atenção. O painel já possuía resumo de pedidos (V1.271), disponibilidade (V1.276) e editor rápido de produtos (V1.277–V1.281). A V1.282 **reorganiza** essa experiência, sem duplicar editores nem implementar transações novas.

## Experiência
- Resumo do próximo pedido relevante trazido para a parte superior, logo após o indicador de operação.
- Nova seção **O que precisa da sua atenção** para titulares e gerentes, derivada somente do catálogo da revenda autenticada: ajustes ainda não salvos, produtos ativos sem estoque ou com estoque baixo (até 3 unidades), preços que precisam ser confirmados e cadastros incompletos.
- Pendência de confirmação de taxa de entrega aparece separadamente quando a checagem existente aponta desatualização.
- Ações apenas de navegação para o editor rápido, catálogo completo ou configuração de entrega. **Nenhuma alteração é executada automaticamente**, inclusive o estado online/offline.
- Equipe operacional mantém o resumo de pedidos, sem receber permissões de edição do catálogo. Motoristas mantêm o fluxo de entregas já existente.
- Quando não há alertas dos itens verificados, o texto delimita esse escopo e não alega que toda a revenda está habilitada ou que existem vendas.

## Proteções e provas
- Não mexe no Supabase, nas Edge Functions, em pedidos, pagamentos, comissões, preços persistidos, estoque persistido ou no histórico V1.280/281.
- Reaproveita os métodos de validação e confirmação já existentes.
- Dados de catálogo incompletos são marcados como problema, e produtos inativos não são contados como estoque esgotado.
- Teste `tests/merchant-daily-checklist-v1-282.mjs` para prioridades, permissões, nenhum salvamento automático, dados inválidos, agenda única e posição acima do editor.
- Build, auditoria estática, regressão de finanças/segurança e navegador móvel precisam passar antes da publicação.
