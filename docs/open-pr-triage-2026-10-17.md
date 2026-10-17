# Triagem das PRs históricas abertas — TAMÃO

**Fotografia de 17/10/2026; não atualiza automaticamente.** Base: `main` no commit `5e187c50554b133545db5003bfb2ab9d0a082077`.

Foram consultadas as 23 PRs abertas no GitHub e realizadas comparações das respectivas branches com `main`. **Todas retornaram estado `diverged`**: estão à frente em commits próprios, mas também centenas de commits atrás da `main`. Portanto, **não se comprovou** que o código inteiro de alguma delas deva ser integrado, nem que esteja totalmente substituído.

`À frente / atrás` na tabela = quantidade de commits, segundo comparação do GitHub; **não significa quantidade de funcionalidades ausentes**. Prioridade é **ordem de revisão por risco**, não autorização de merge nem confirmação de bug em produção.

| PR | Tema | À frente / atrás | Revisão | Próxima conferência |
|---|---|---:|:---:|---|
| [#252](https://github.com/carloskk07/gassg/pull/252) | CRM: contexto de negociações | 3 / 562 | P1 | Revisar regressão de contexto e histórico de follow-up |
| [#241](https://github.com/carloskk07/gassg/pull/241) | Financeiro: desempenho e risco D+1 | 13 / 572 | P0 | Auditar integridade financeira e migrations; não reimplantar automaticamente |
| [#215](https://github.com/carloskk07/gassg/pull/215) | Jornada: confirmação e acompanhamento | 123 / 620 | P1 | Cadeia dependente 205→215; comparar cenários e testes |
| [#214](https://github.com/carloskk07/gassg/pull/214) | Jornada: comparação de ofertas | 115 / 620 | P1 | Cadeia dependente 205→215; não aplicar CSS/JS antigos |
| [#213](https://github.com/carloskk07/gassg/pull/213) | Jornada: atualização automática por endereço | 103 / 620 | P1 | Cadeia dependente 205→215; validar deduplicação |
| [#212](https://github.com/carloskk07/gassg/pull/212) | Jornada: CEP até o pedido | 95 / 620 | P1 | Cadeia dependente 205→215; preservar carrinho e valores |
| [#211](https://github.com/carloskk07/gassg/pull/211) | Jornada: região e disponibilidade | 87 / 620 | P1 | Cadeia dependente 205→215; não inventar ofertas |
| [#210](https://github.com/carloskk07/gassg/pull/210) | Marketing: conversão por região | 74 / 620 | P1 | Cadeia dependente 205→215; checar layout atual |
| [#209](https://github.com/carloskk07/gassg/pull/209) | Cadastro: representação jurídica de revendas | 55 / 620 | P0 | Conformidade e autoridades SQL/Edge |
| [#208](https://github.com/carloskk07/gassg/pull/208) | Cobrança: vencimento diário | 45 / 620 | P0 | Invariantes financeiras; revisar SQL |
| [#207](https://github.com/carloskk07/gassg/pull/207) | Produtos: exigências ANP por cesta | 37 / 620 | P0 | Conformidade de GLP sem bloquear SKUs genéricos |
| [#205](https://github.com/carloskk07/gassg/pull/205) | Checkout: pagamento na entrega | 27 / 620 | P0 | Autoridade de pagamento; evitar regressão |
| [#109](https://github.com/carloskk07/gassg/pull/109) | Catálogo: autoridade de retry | 5 / 821 | P0 | Deduplicação/consistência dos pedidos em caso de repetição |
| [#106](https://github.com/carloskk07/gassg/pull/106) | Revendas: polling adaptativo | 2 / 823 | P2 | Verificar custo de polling e regressões |
| [#94](https://github.com/carloskk07/gassg/pull/94) | Admin: convite de novos administradores | 3 / 833 | P0 | Autorização e trilha de auditoria |
| [#90](https://github.com/carloskk07/gassg/pull/90) | Formulários: idempotência pública | 8 / 836 | P0 | Comparar com implementação mais recente |
| [#88](https://github.com/carloskk07/gassg/pull/88) | Formulários: tentativas idempotentes | 4 / 837 | P0 | Comparar com implementação mais recente |
| [#86](https://github.com/carloskk07/gassg/pull/86) | Formulários: idempotência de envios | 7 / 838 | P0 | Comparar com implementação mais recente |
| [#82](https://github.com/carloskk07/gassg/pull/82) | Piloto: fronteira de resgate | 2 / 840 | P0 | Migrações e estado operacional |
| [#81](https://github.com/carloskk07/gassg/pull/81) | Revenda: polling em inatividade | 2 / 840 | P2 | Investigar custo CPU/rede |
| [#73](https://github.com/carloskk07/gassg/pull/73) | SQL: terminador de migração | 4 / 845 | P0 | Conferir validação SQL atual |
| [#70](https://github.com/carloskk07/gassg/pull/70) | PWA: integridade do cache | 6 / 847 | P1 | Conferir sobreposição com PR #462 antes de concluir |
| [#38](https://github.com/carloskk07/gassg/pull/38) | Piloto: ativação assistida | 7 / 877 | P0 | Verificar mecanismos atuais de convite e ativação |

Resumo: **23 abertas; 13 em P0 (fluxos regulados/financeiros e autoridade), 8 em P1 (jornadas de compra/CRM/cache), 2 em P2 (otimização de polling).** Todas permanecem abertas nesta triagem, sem merges, sem rebase automático e sem cancelamentos.

## Relação de dependência mais perigosa

A sequência **#205 → #207 → #208 → #209 → #210 → #211 → #212 → #213 → #214 → #215** foi criada como PRs sobre outras branches de funcionalidades. Os últimos PRs abrangem diversas migrações, módulos de frontend e Edge Functions. A comparação cumulativa com `main` não equivale ao diff específico de cada etapa. Retarget para `main` ou squash de toda a cadeia sem separar as mudanças pode reintroduzir regras antigas.

## Critério para resolver uma PR antiga

1. Leia o diff específico da PR e a versão vigente da mesma função, migração ou controle.
2. Confira testes funcionais equivalentes e, para SQL/Edge, o estado e os contratos atuais do Supabase. **Nunca execute migrations antigas só porque aparecem em PR aberta.**
3. Classifique a mudança em **já incorporada**, **substituída por solução equivalente**, **melhoria pontual aproveitável** ou **bloqueada por conflito/risco**. Registre evidências.
4. Para melhoria útil, abra uma **nova PR mínima baseada na `main` atual**, com teste de regressão; não faça merge direto da branch desatualizada.
5. Apenas depois de provar duplicação/obsolescência, feche a PR histórica com comentário e referência à implementação que a substituiu. Não feche em massa nem apague o histórico.

## Fonte canônica

O guia [fonte oficial de versão](release-authority.md) explica como distinguir título da PR, SHA da `main` e SHA efetivamente publicada nos três portais. Esta lista é um inventário de engenharia, não uma garantia de que os respectivos fluxos financeiros estejam habilitados.
