# TAMÃO V1.339 — Da pendência vencida à análise em um clique

Data: 16/10/2026. Escopo: Admin → Aquisição / Financiamento.

## Melhoria de fluxo

A V1.338 passou a mostrar pendências de comissão por prazo, mas o administrador precisava localizar novamente o caso na central de repasses para consultar ou registrar a análise. Quando o caso não pertencia à página de 30 registros atualmente exibida, o comando de histórico da V1.337 não aceitava a navegação.

A V1.339 disponibiliza o botão **Analisar esta pendência** diretamente em cada cartão da central de prazos. O botão abre o histórico imutável já existente e, no perfil `superadmin`, o formulário de registro de nova análise administrativa. O perfil `finance` apenas visualiza o histórico. Não há nova RPC, tabela, cron, migração ou autorização de pagamentos.

## Limites de autorização e consistência

- O frontend comprova que a declaração consta na fonte que originou o clique (lista do provedor ou fila de prazos), pertence ao administrador e à competência selecionada e mantém a mesma referência ao longo da consulta.
- O servidor `admin-ops` continua validando sessão e cargo, enquanto as funções V1.337 restringem gravação ao `superadmin`.
- A interface de histórico é compartilhada, sem duplicação de formulário. Um histórico aberto pela fila de prazos só é apresentado nela; aberto pela lista do provedor, só naquela lista.
- Se a competência muda ou a declaração deixa de integrar a página carregada, o histórico não pode ser reutilizado para registrar análise.
- Após a confirmação de uma nova análise originada na fila de prazos, os totais e casos da fila são recarregados; só se reabre o histórico caso a declaração continue presente na fila. Uma solicitação de escrita com resposta ambígua mantém a chave idempotente existente para inspeção.
- Nenhum estado administrativo é tratado como liquidação bancária, titularidade verificada ou movimentação de recursos.

## Cobertura automatizada

`tests/payout-followup-direct-review-v1-339.mjs` inclui caso presente **somente** na fila de prazos, sem registro na página do provedor; botão de acesso direto, leitura e registro único, atualização de totais, isolamento entre competências e permissões do perfil financeiro.

Os testes V1.337 e V1.338 continuam no Audit. A atualização envolve somente `js/admin-acquisition.js` e testes/documentação; código financeiro do banco e Edge Functions permanecem sem alteração.

## Publicação

Exigir Audit aprovado, construção dos portais, integração segura, comprovação de versão nos domínios e reconciliação Cloudflare. Preservar `PRELAUNCH` e `commerce_enabled=false`. Sem transações nem pedidos de teste reais.
