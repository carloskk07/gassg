# TAMÃO V1.279 — Rascunhos de estoque protegidos e histórico recente verificável

**Objetivo:** evitar que a revenda perca um preço ou estoque digitado durante atualizações da operação, e facilitar a revisão de produtos importantes.

## O que mudou

- O editor rápido mantém em memória os valores ainda não salvos durante novas renderizações do painel, incluindo atualizações de pedidos. O rascunho é separado por identificador da revenda e código do produto.
- **Os campos e os botões −1, +1 e +5 continuam sem enviar dados automaticamente.** Salvar alterações continua sendo a única ação que grava preço e estoque no servidor.
- Antes de trocar de revenda, sair da conta ou abrir o catálogo completo com dados pendentes, o usuário recebe uma confirmação de descarte. O navegador também alerta ao fechar/recarregar a aba com um rascunho pendente. O aviso de rascunho fica visível no produto e o editor abre quando existem alterações.
- Quando o servidor devolve uma versão diferente do produto (`updatedAt`, preço ou estoque alterado), o rascunho antigo é descartado em favor dos novos dados. Isso evita sobrescrever silenciosamente alterações externas; a verificação de versão e idempotência do backend seguem obrigatórias.
- Na lista compacta, o P13 mantém destaque e, depois, produtos esgotados, com estoque baixo e com preço pendente de confirmação vêm antes dos demais.
- Uma seção chamada **Últimas atualizações registradas** apresenta até cinco produtos com timestamp `updatedAt` válido retornado pelo servidor. É somente a última data registrada de cada produto: **não é um histórico de cada venda, reposição ou movimentação**, nem inventa alterações.

## Segurança e limites

Rascunhos ficam apenas na memória da aba e são eliminados ao descartá-los, salvar ou trocar de revenda. Não vão para localStorage, analytics nem APIs até a confirmação explícita. Permissões de proprietário/gerente, estoque inteiro, preço, faixa, concorrência e autorização do servidor não mudam. Sem migrações, Edge Functions ou alterações financeiras.

## Validação

`tests/merchant-protected-drafts-v1-279.mjs` cobre edição manual, reposição rápida, redesenho, confirmação ao navegar, conflito de versão, falha de servidor, permissões, escape de nomes e últimos registros; regressões V1.276–V1.278 foram adaptadas para os helpers compartilhados. Auditoria geral, build e E2E móvel obrigatórios.
