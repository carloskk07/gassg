# TAMÃO V1.249 — Central de financiamento e crescimento

## Objetivo
Deixar o fluxo financeiro inicial administrável por uma única pessoa, sem transformar planejamento em dinheiro disponível nem mudar autorizações para operações reais.

### Antes
Admin → Aquisição exibia simultaneamente três painéis extensos:
- Planejamento do fundador e indicadores de concessões;
- Aportes e referências bancárias;
- Distribuição de orçamento por campanha.

Cada um exigia nova consulta manual e os períodos podiam ser confundidos.

### Agora
**Central de financiamento e crescimento** substitui os três painéis extensos na tela principal. Há quatro opções: **Visão geral**, **Planejamento**, **Aportes**, **Campanhas**.

Um único botão "Atualizar visão financeira" solicita em paralelo, usando as quatro ações administrativas já autorizadas:
- `owner-funding-read` (V1.244)
- `owner-funding-pulse` (V1.245)
- `owner-evidence-queue` (V1.246)
- `owner-budget-queue` (V1.247)

**A consulta agregada não tem ações de escrita.** Os botões de operações ficam apenas nas abas apropriadas, seguindo as mesmas permissões por perfil de antes. O superadmin conserva sua auto-conferência de aportes da V1.248; finance continua com segregação.

## Indicadores e significados
- **Orçamento planejado/mês**: soma dos quatro centros do fundador para o orçamento mensal. Não é depósito.
- **Distribuído em campanhas/mês**: alocação do plano no mês corrente, sem movimentação financeira.
- **Emissões válidas geradas no mês**: concessões do mês, líquidas das reversões dessa coorte, não são pagamentos.
- **Aportes conferidos manualmente**: total histórico classificado como conciliado manualmente; não indica saldo provado via API bancária.
- **Pendências**: total de aportes em fila, calculado pelo servidor.
- Cada centro exibe teto, alocado, não distribuído e concessões; a comparação de concessões e planejamento não significa que um abate contabilmente o outro.

Consultas só são aceitas com `source`, marcadores de leitura, limites monetários, quatro centros, competências do mesmo mês e zero no campo de dinheiro disponível. Uma falha invalida o resumo consolidado; nenhum dado de outra sessão é mostrado após troca de usuário. Sem consulta válida, o painel não inventa valores.

## Testes e publicação
- Regressão: `node tests/owner-finance-center-v1-249.mjs`.
- Auditoria e build GitHub.
- Sem mudanças em tabelas, funções SQL, Edge Functions, contratos de PSP, regras de recompensas ou Cloudflare DNS.
- O deploy automático dos portais segue os workflows oficiais do repositório; confirmar a mesma versão em produção antes de anunciar a nova interface.

## Próxima melhoria
Acrescentar no Admin um histórico financeiro pesquisável com filtros por mês e por centro de incentivo, sem confundir aporte, saldo e valor planejado.
