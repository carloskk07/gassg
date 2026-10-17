# TAMÃO V1.387 — Atendimentos pendentes na fila da revenda

17/10/2026

## Objetivo

A V1.386 já disponibiliza à revenda um resumo privado e estritamente limitado de atendimentos vinculados aos seus próprios pedidos ativos. Até aqui, esses registros só apareciam no resumo geral e em cada pedido, podendo passar despercebidos quando a fila estava longa ou tinha pedidos rotineiros recolhidos em «Ver mais».

## Mudanças no portal

- Novo **quadro de atenção aos atendimentos** dentro de **Pedidos que exigem ação**, antes da fila operacional. Ele lista até cinco pedidos com chamados `open` ou `in_review`, identificando assunto, quantidade e situação da ocorrência. O acesso **Ver pedido** leva ao cartão já existente, expandindo se necessário os detalhes internos do pedido.
- **Prioridade conservadora:** primeiro atendimentos `open`, com registros mais antigos antes; depois os que estão `in_review`. Datas ausentes não são transformadas em antiguidade, atraso ou promessa de resolução. O resumo informa quando existem mais pedidos com ocorrências.
- **Cartões protegidos contra ocultação:** pedidos em preparação ou entrega que contêm atendimentos pendentes permanecem visíveis, mesmo quando a fila compacta os pedidos rotineiros. Novas ofertas continuam agrupadas e separadas na sua própria etapa.
- **Sem duplicar poderes:** a nova tela orienta a revenda a consultar o pedido e acompanhar a tratativa. Não inclui assumir, resolver, encerrar, registrar nota de resolução, mudar o status nem confirmar um pagamento ou entrega.
- **Mobile:** lista compacta com assuntos e estados legíveis, botão largo e foco visível em celulares pequenos; respeito a movimento reduzido.

## Evidência e privacidade

A tela só usa os dados já entregues pela função `merchant-orders` V1.386 para a própria revenda. Não consulta a tabela `support_cases` diretamente. O quadro só é apresentado quando:

1. A conta tem papel `owner`, `manager` ou `operator` habilitado para o escopo `merchant-active-orders`.
2. A lista de pedidos é a mesma instância da leitura autenticada recebida do servidor.
3. A última consulta daquela revenda foi validada e tem no máximo dois minutos, conforme o controle já existente em `merchantOrderListEvidence`.

A quantidade é apenas dos registros carregados (até 100), não uma afirmação de inexistência de outros chamados. Casos de pedidos ainda `OFFERED_TO_MERCHANT` são excluídos. Nenhum dado de contato, mensagem pessoal, nome de atendente, código PIN ou nota administrativa é incluído. O endpoint, a RLS, as permissões, as comissões e todas as operações financeiras permanecem inalterados.

## Validação

O teste `tests/merchant-support-priorities-v1-387.mjs` protege: ordenação, filtro de caso aberto ou em análise, não ocultação em «Ver mais», vínculo do botão ao UUID verificado, proteção de dados privados, escopo/role, estado sem conexão, tempo da consulta e layout mobile.

Antes do merge: Audit completo, build isolado dos três portais e regressões antigas de fila e entrega. Após o merge: confirmação do commit em Cloudflare via verificação de publicação e reconciliação.

Não é alegada redução de SLA ou chamados sem mensuração real.
