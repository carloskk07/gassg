# TAMÃO V1.258 — limpeza individual e auditada dos comprovantes órfãos

## Objetivo
O painel de auditoria V1.257 identifica arquivos enviados ao armazenamento privado mas não vinculados a despesas. A V1.258 acrescenta uma ação para remover um único objeto por vez, apenas após confirmação expressa do administrador principal.

## Elegibilidade
O arquivo deve estar no bucket privado, não ser um marcador de exclusão, ter mais de 24 horas desde o upload, seguir o caminho UUID/UUID.pdf|png|jpg, pertencer a uma despesa existente, não ter comprovante vinculado e não ter operação de exclusão concorrente ativa. A lista mostra até 20 arquivos por vez, com identificador técnico e horário, sem expor caminhos internos.

## Permissões e execução
Os perfis superadmin e finance podem consultar candidatos. Apenas superadmin pode remover. Para cada arquivo precisa digitar EXCLUIR na interface. A Edge exige essa confirmação e valida o papel administrativo novamente. A reserva revalida todos os pré-requisitos, usa advisory lock por despesa e insere um registro de autorização. A remoção utiliza a API oficial do Supabase Storage para exatamente um caminho. A finalização consulta o banco e somente registra sucesso quando o objeto não existe mais no Storage.

## Histórico e falhas
Duas tabelas append-only, com RLS e sem privilégios de acesso direto, guardam os pedidos (ator, objeto, data) e resultados (ausência confirmada ou falha). Uma chamada interrompida pode manter pedido sem resultado; sua investigação é necessária. Solicitações em andamento têm janela de proteção de 15 minutos antes de nova avaliação. Não há mecanismo de exclusão em massa nem automação.

A anexação de comprovantes da V1.256 foi reforçada para rejeitar caminhos reservados para remoção e caminhos que não existem no armazenamento. Assim, um upload tardio não cria metadados de um comprovante em remoção.

## Limites
Exclusão no Storage é permanente. Um arquivo vinculado, mesmo de uma despesa posteriormente corrigida, jamais é elegível. O Admin não remove nada automaticamente nem usa dados fictícios. Nenhuma movimentação financeira, comissão, cupom, cashback ou orçamento sofre alteração.

## Arquivos
- supabase/migrations/20261014233000_owner_receipt_orphan_cleanup_v1_258.sql
- supabase/functions/admin-ops/index.ts
- js/admin-acquisition.js
- js/bootstrap.js
- tests/owner-receipt-orphan-cleanup-v1-258.mjs
