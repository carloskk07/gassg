# TAMÃO V1.385 — Triagem de atendimentos pela administração

Data: 17/10/2026.

## Necessidade operacional

Após a V1.384, o cliente consegue ver seus chamados, mas a área administrativa mostrava todos os registros misturados. Sem filtro ou busca, a equipe podia deixar passar uma solicitação pendente e gastar tempo percorrendo chamados já resolvidos.

O TAMÃO já possui a ação `support-case-status` com autenticação, autorização por papel, histórico e nota obrigatória para resolver ou encerrar. A V1.385 **não duplica esse mecanismo**.

## Implementação

- **Fila priorizada:** primeiro chamados abertos, com os mais antigos acima; depois em análise; por fim resolvidos e registros com estados não reconhecidos.
- **Leitura rápida:** quantos aguardam análise, quantos estão em análise e quantos foram resolvidos dentre os dados carregados.
- **Busca e filtros client-side:** pedido, assunto ou situação; filtros pendentes/abertos/em análise/resolvidos/todos carregados. O filtro selecionado sobrevive a uma atualização periódica da área enquanto o painel estiver aberto.
- **Acesso contextual:** botão para abrir detalhe do pedido relacionado, somente se houver identificador válido.
- **Ações por papel:** superadmin, operações e suporte veem botões de assumir análise, resolver e encerrar; finanças pode consultar a fila na seção Pedidos, mas não recebe controle de alteração. O servidor continua a verificar toda operação e exigir justificativa para resolução/encerramento.
- **Data e evidência:** abertura e atualização só aparecem quando timestamps recebidos são válidos. A tela informa a atualização do painel e os limites de resultados.
- **Mobile:** filtros acessíveis, campos confortáveis, cartões legíveis, botões de toque maiores e anúncio do total visível para leitor de tela.

## Limites de dados

A consulta existente do `admin-ops` entrega até **100 casos** com estados `open`, `in_review` e `resolved` ordenados por atualização. A fila não é pesquisa completa do banco nem comprova inexistência de chamados mais antigos não carregados. Chamados encerrados (`closed`) só serão mostrados se a consulta administrativa futura os incluir, sem alteração de backend nesta versão.

Nenhum dado de cliente foi repassado a revendas. Apenas usuários já autorizados a consultar a administração enxergam a fila.

## Segurança e testes

- `tests/admin-support-triage-v1-385.mjs`: ordenação, prioridades, datas inválidas, busca, filtro persistente, controle por papel, escape de HTML, validação de UUID e isolamento de mutações.
- `Audit` e `Build isolated live portals` antes do merge; testes mobile 320/360/390 px incluídos na auditoria.
- Após integrar, conferir SHA no pipeline oficial Cloudflare e a reconciliação do deploy.
- Não alteradas as regras de ordem, reembolso, comissão, campanhas ou autorização de abertura de cidades.

## Próximo incremento possível

A exibição para revendas exigirá definir, testar e autorizar um endpoint com informações minimizadas; **não** será implementada pela cópia de detalhes administrativos ou pela concessão de acesso à tabela `support_cases`.
