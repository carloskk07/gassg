# TAMÃO V1.349 — Foco executivo e confiança operacional

Data: 16/10/2026.

## Diagnóstico
A página administrativa já possuía indicadores e um centro de atenção, porém os registros urgentes apareciam após vários módulos extensos de configuração. O proprietário precisava localizar visualmente a próxima decisão antes de navegar pelo grande volume de recursos existentes.

A lista de atenção também era composta sem filtrar os destinos por permissão da área; ações poderiam aparecer para perfis que não tinham acesso à seção correspondente.

## Mudanças
1. **Próxima decisão**: cartão compacto após os indicadores, antes do centro de atenção, indicando a categoria mais importante e o atalho de navegação correspondente.
2. **Hierarquia segura**: dados não confirmados ou vencidos (>15 min) exigem atualização antes de recomendar decisão. Dados futuros com diferença superior a um minuto também não são aceitos como atuais.
3. Prioridade determinada por fatos da última consulta: bloqueios de segurança, incidentes, risco de pedidos, conferência financeira, atendimentos, cadastros e preparação comercial. Não agrega métricas de resultados hipotéticos.
4. **Acesso por perfil**: recomendações usam `adminRoleCanSection` para construir atalhos apenas para seções autorizadas. O centro de atenção passa a filtrar ações para áreas compatíveis com o perfil.
5. Prioridades no início da página: KPIs executivos → orientação → centro de atenção → prontidão comercial → governança → central de liberações. Evita que decisões críticas fiquem depois de listas extensas.
6. Ao mudar de seção, foco do teclado vai para o título principal. Interfaces de 320–390px recebem layout de coluna única com CTA legível.

## Invariantes
- Sem SQL, Edge Functions, PSP, concessões de privilégios, mudanças de estado de cidades, transações, políticas financeiras, preços ou estoque.
- Todos os atalhos novos chamam `adminSetSection` ou a leitura `adminRefresh` existente; não executam aprovações nem alterações de negócio.
- O cartão não declara "tudo em ordem" a partir de um resumo parcial e não substitui a consulta às centrais especializadas.
- O sistema ainda precisa de revisão visual e testes humanos autenticados do painel; CI não garante conversão nem usabilidade real.

## Verificações
- `tests/admin-executive-focus-v1-349.mjs`: cenários de prioridade, sessão desatualizada, isolamento por perfil, ações somente navegacionais, DOM/teclado e layout móvel.
- Audit, Build isolated live portals, launch readiness, Cloudflare deploy e reconciliação devem concluir antes da entrega definitiva.
