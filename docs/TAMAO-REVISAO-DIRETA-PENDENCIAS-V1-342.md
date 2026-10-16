# TAMÃO V1.342 — abrir e revisar declaração exata da fila global

Data: 16 de outubro de 2026. Área: Admin → Aquisição / Financiamento → Pendências de todas as competências.

## Gargalo identificado

A V1.340 apresenta as declarações não resolvidas de todos os meses, e a V1.341 permite avançar além dos 30 casos iniciais. Entretanto, o botão **Abrir competência para revisar** apenas mudava o mês do painel. O administrador ainda precisava encontrar manualmente a declaração original na lista mensal, que usa outra ordenação e paginação. Isso poderia consumir várias navegações para cada pendência crítica.

## Correção

- Novo botão **Analisar esta declaração** em cada cartão global, inclusive nas páginas seguintes.
- O clique exige a declaração presente na página global **efetivamente carregada**, o perfil `superadmin` ou `finance` e valida a sessão atual.
- A leitura usa o RPC já existente `owner-payout-review-read` da V1.337; nenhum novo endpoint, tabela, cron, permissão ou função financeira é criado.
- O histórico e o formulário aparecem **dentro da visão global**, sem trocar a competência mensal selecionada.
- Apenas `superadmin` pode registrar uma análise justificada; `finance` continua com leitura. A gravação usa a chave de idempotência e o diário imutável existentes.
- Depois de uma gravação confirmada, a página global atual é consultada novamente, para refletir a situação e, quando o caso ainda permanecer visível, atualizar a linha do tempo. Se a mudança retirar a pendência da fila, ela deixa de permitir ações com o snapshot antigo.
- O botão anterior **Abrir competência para revisar** permanece disponível.

## Limites e segurança

A fonte da declaração é validada pelo próprio painel global autorizado, não pelo mês atualmente selecionado; as fontes mensais continuam bloqueadas contra mudança de competência. Respostas inválidas, troca de usuário/perfil e remoção do registro da página impedem nova análise por meio de estado antigo.

O diário é **administrativo**: estados como `closed_administrative` não comprovam pagamento, destinatário, compensação bancária ou recuperação de fundos. Nenhum valor é transferido, estornado ou creditado pela V1.342.

## Testes

`tests/payout-global-direct-review-v1-342.mjs` valida abertura de declaração de mês anterior sem mudar o mês atual, leitura de histórico, registro restrito ao administrador principal, atualização posterior da fila, leitura por `finance`, ausência de acesso por outros papéis e bloqueio de registros que saíram da página. As regressões isoladas V1.340/V1.341 recebem um stub apenas para o componente novo e continuam exercitando suas regras originais.

Como é uma correção exclusivamente de interface, não há migração ou publicação adicional de Edge Function. Exigir CI Audit e Build, merge, publicação Cloudflare e verificação dos três portais sob `PRELAUNCH`.

Estado da operação no início do desenvolvimento: sem pedidos ou declarações financeiras reais.
