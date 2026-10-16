# TAMÃO V1.343 — Recuperação automática da paginação financeira

Data: 16 de outubro de 2026. Módulo: Admin → Aquisição/Financiamento → Pendências de todas as competências.

## Falha identificada

A fila global V1.341 usa paginação por deslocamento e V1.342 permite concluir uma revisão diretamente na página ativa. Ao mudar o estado de `closed_administrative`, a declaração deixa a fila; se era a última da última página, a consulta posterior do mesmo deslocamento devolve uma página vazia, mesmo quando existem itens em páginas anteriores. Nesse estado, a interface podia indicar uma faixa como **Mostrando 0–30 de 30** na página 2, confusa e incoerente.

## Correção V1.343

- Depois de validar o contrato integral da resposta do servidor, se a página solicitada estiver vazia e seu deslocamento não possuir mais itens, calcular a última página válida `floor((activeClaims-1)/30)*30`, ou a página zero quando a fila inteira estiver vazia.
- Limpar o snapshot antigo de pendências e eventual histórico global selecionado que não deve continuar acionável.
- Recarregar **no máximo uma vez**, já fora do bloqueio de carregamento, mantendo o mesmo controle de usuário, perfil e contrato das leituras existentes.
- Se o total mudar novamente durante a recuperação, rejeitar a página vazia com mensagem orientando o administrador a atualizar. Não fazer loops indefinidos nem exibir paginação enganosa.
- Ao receber uma página nova, descartar qualquer histórico global de declaração que saiu da página, evitando reutilização de contexto anterior.
- Nenhuma mudança nos RPCs, cron, métodos de pagamento, permissões, estado financeiro ou no diário imutável.

## Testes

O teste `tests/payout-global-page-recovery-v1-343.mjs` cobre:
- 35 → 30 casos, página 2 esvaziada: retorno automático à página 1.
- 35 → 0 casos: tela vazia com faixa coerente.
- Segundo encolhimento concorrente: resposta rejeitada, máximo de duas consultas e nenhuma ação com informação antiga.
- Histórico global descartado quando o item sai da página e acesso vedado a perfil não autorizado.

A CI Audit executa os testes V1.340–V1.342 e o teste V1.343. Como é uma alteração **exclusivamente de frontend**, não exige migração de Supabase nem publicação de Edge Functions. Exigir merge após CI verde e verificação dos três domínios por Cloudflare e prontidão.

## Limites

Paginação por OFFSET não é um snapshot imutável entre consultas. Essa melhoria evita páginas órfãs quando a lista encolhe, mas não garante que uma fila altamente concorrida jamais mude de ordem enquanto o operador navega. Não realiza pagamentos ou recuperações. São Gabriel permanece em `PRELAUNCH`.
