# TAMÃO V1.280 — Histórico verdadeiro das alterações de preços e estoque

## Registros na fonte de verdade

A nova tabela `public.merchant_catalog_change_events` registra cada alteração **confirmada** na função transacional `merchant_catalog_action`, incluindo a revenda, produto, usuário autorizado, papel no momento da ação, nome do integrante quando disponível, idempotência, valores antigos/novos de preço, estoque, disponibilidade, modo/limites/estratégia de precificação e confirmação de preço.

A escrita ocorre na **mesma transação** da gravação do produto. Solicitações rejeitadas não geram histórico e reexecuções idempotentes retornam antecipadamente, sem duplicar eventos. `source_key` é único. O histórico começa quando a migração é aplicada; **não é retroativo**, para não inventar responsáveis ou valores anteriores.

## Consulta autorizada

`merchant-ops` acrescenta a ação de leitura `catalog-history`. Somente o **titular ou gerente ativo da própria revenda** pode consultar; o serviço verifica JWT e membership antes de ler. O filtro de revenda, a ordenação por ID decrescente e o limite de 30 eventos são definidos no backend.

A tabela tem RLS habilitada e **não concede acesso direto a anon/autenticados**; a função proprietária grava eventos, e apenas a service role pode consultar diretamente. A UI não recebe permissão de insert/update/delete. O painel apresenta `Histórico real de preços e estoque` somente após o usuário escolher **Consultar histórico**, mostrando responsável, data, código/nome do produto e os valores anteriores/novos. Um cadastro inicial aparece com valor anterior em branco. Há botão de atualização manual. A seção `Últimas atualizações registradas` permanece como consulta dos timestamps recentes, separada do histórico verdadeiro.

## Segurança e validação

Nenhuma alteração em confirmações de pedidos, dinheiro, PSP, taxas ou controle de estoque. Os registros são exclusivos da transação de catálogo. Eventos antigos não são recriados. O histórico é somente leitura, protegido de vazamento entre revendas e exibido com escape HTML. O teste `tests/merchant-audit-history-v1-280.mjs` cobre RLS/grants, dados anteriores/novos, idempotência, escopo, papéis, XSS e trocas assíncronas de revenda. Verificações de Supabase e CI documentam o resultado.
