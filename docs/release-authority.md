# TAMÃO — fonte de verdade da versão publicada

Este documento orienta a identificação da revisão oficial **sem confundir números de tarefas/PRs com aplicações em execução**. O código canônico e o artefato implantado são duas coisas diferentes.

## Um único ramo oficial; três portais isolados

- Código autorizado: branch [`main`](https://github.com/carloskk07/gassg/tree/main) do repositório `carloskk07/gassg`.
- Domínios oficiais: [cliente](https://tamao.com.br/portal-build.json), [revenda](https://parceiro.tamao.com.br/portal-build.json), [admin](https://admin.tamao.com.br/portal-build.json).
- Os três usam o mesmo commit de origem, mas recebem pacotes próprios com `portalRole: customer | merchant | admin`.
- `portal-build.json` contém `schemaVersion`, `portalRole`, `sourceSha` e origens. **`schemaVersion: 1` é a versão do formato do manifesto, não uma V1 do produto.**
- `sw.js` no pacote de produção usa cache com o identificador `sourceSha`. Um número histórico encontrado no `sw.js` de origem não determina a revisão do cache implantado.

## Como confirmar a publicação de uma revisão

1. Consulte a SHA da `main` no GitHub. Não use a V1.xxx do título da última PR como identificação única do código.
2. Confira os três `/portal-build.json` acima. Os respectivos `sourceSha` devem coincidir **entre si** e com a SHA a ser atestada. Os papéis devem corresponder aos seus domínios.
3. Confira as execuções para essa SHA dos workflows `Audit`, `Build isolated live portals`, `TAMÃO Cloudflare official production deploy`, `TAMÃO launch readiness` e `TAMÃO Cloudflare native delivery reconcile` em [Actions](https://github.com/carloskk07/gassg/actions).
4. Se algum manifesto estiver ausente, divergente ou atrasado, relate **publicação não confirmada** e investigue a entrega, sem presumir que uma PR integrada publicou com sucesso. Os testes de prontidão estrita devem falhar quando os portais não corresponderem à revisão esperada.

O portal de administração tem regras próprias de segurança; um `sourceSha` igual não concede acesso nem abre cidades. Autorizações comerciais e financeiras continuam sujeitas às verificações do servidor.

## O que significam os números antigos

- Identificadores `V1.44`, `V1.70`, `V1.158`, `V1.201` etc. em títulos e documentação são **marcadores de marcos técnicos da época**. Não representam vários frontends ativos ao mesmo tempo.
- Seções denominadas anteriormente "Estado atual" no README foram reclassificadas como `Registro histórico`.
- PR aberta é **trabalho pendente de triagem**, não release em produção. Uma branch à frente da base original e simultaneamente centenas de commits atrás da `main` pode conter código obsoleto e alterações ainda úteis; não é seguro aplicar o diff inteiro sem rebase e revisão funcional.
- Nenhuma revisão histórica deve sobrescrever rotas, políticas financeiras, RLS, Edge Functions, autenticação, fluxos de pagamento ou decisões comerciais sem testes e aprovação correspondentes.

## Última conferência desta nota — 17/10/2026

Na revisão deste documento, `main` estava em `5e187c50554b133545db5003bfb2ab9d0a082077`, com todos os cinco workflows acima concluídos com sucesso. Esse SHA é **registro de auditoria, não um valor fixo de versão**; siga sempre os passos anteriores para identificar a versão mais recente.

A separação inicial do JavaScript administrativo, a limpeza do CSS e o controle de cache foram introduzidos pelas PRs [#464](https://github.com/carloskk07/gassg/pull/464), [#463](https://github.com/carloskk07/gassg/pull/463) e [#462](https://github.com/carloskk07/gassg/pull/462). O acompanhamento das PRs anteriores está em [triagem histórica](open-pr-triage-2026-10-17.md).
