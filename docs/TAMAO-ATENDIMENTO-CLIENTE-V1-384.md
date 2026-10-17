# TAMÃO V1.384 — Acompanhamento de atendimento do cliente

17/10/2026

## Diagnóstico

Na jornada de acompanhamento, os registros de suporte retornados por `get-order` eram condensados em um aviso apenas para `open` e `in_review`. O visitante não enxergava o histórico de chamados encerrados ou resolvidos, nem a data comprovada de abertura. O botão **Registrar problema** permanecia disponível mesmo quando um caso da mesma categoria já estava ativo, dependendo somente da deduplicação do backend.

Também existia ambiguidade após envio confirmado: o serviço `customer-care` podia reconhecer o registro, mas uma falha posterior na atualização do pedido fazia o frontend exibir erro como se o envio não tivesse ocorrido.

## Evolução

- **Histórico real de até dez atendimentos**, recebidos do `get-order` para o próprio usuário/pedido: categoria, situação (aberto, em análise, resolvido ou encerrado) e datas disponíveis de registro/encerramento. Status desconhecido é descrito como *não confirmado*, não inventado. Detalhes privados de operadores não são apresentados.
- **Comprovação de atualização:** quando a consulta é antiga, indisponível ou não comprovada, a UI descreve explicitamente que a lista pertence à última leitura disponível e oferece a opção de atualizar; nunca promete resposta em prazo arbitrário.
- **Não duplicar solicitações:** a categoria com caso aberto ou em análise é desabilitada para novo envio, sem bloquear outras categorias. A proteção é reforçada por trava de envio enquanto a chamada está pendente. A deduplicação oficial do servidor permanece.
- **Resultado verdadeiro da API:** um `open-case` confirmado pela função do Supabase continua reconhecido mesmo que a leitura seguinte do pedido falhe. O usuário é orientado a atualizar o acompanhamento. A interface não cria registros fictícios no histórico.
- **Acessibilidade mobile:** legibilidade, botões largos, `aria-live` para feedback e tamanho de entrada adequado.

## Integrações e isolamento

Não foram alteradas: criação de pedidos, status de entrega, validação de PIN, pagamento, taxas, comissões, autorização comercial, RLS ou Edge Functions. O controle de casos e da autenticação segue no `customer-care` e em `get-order`.

O backend atual traz `id, category, status, createdAt, resolvedAt`; **não traz** o texto da resolução, mensagens do atendente, horário da última análise nem SLA de resposta. A interface não pode inventar esses dados. A lista é limitada pelo backend aos dez registros mais recentes.

## Provas

- `tests/customer-care-clarity-v1-384.mjs`: dados oficiais, estados abertos/em análise/resolvidos/encerrados, datas, informação antiga, status desconhecido, privacidade, bloqueio de duplicações, duplo toque, falha de rede após API confirmada e navegação mobile.
- Suítes anteriores de cliente/incident tracking preservadas.
- Audit, E2E mobile e Build isolated live portals obrigatórios para integrar.
- Verificação da publicação Cloudflare pelo commit final da `main`, separada dos testes de PR.

A atualização busca diminuir reenvios e dúvidas, mas não atesta redução de suporte ou satisfação até que existam medições reais.
