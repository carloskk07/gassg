# TAMÃO V1.281 — consulta de histórico por produto e páginas

A V1.280 criou uma trilha de alterações realmente confirmadas, iniciada na implantação. A V1.281 melhora a consulta do proprietário e gerente sem modificar a gravação transacional.

## Mudanças
- Filtro opcional por produto, aplicado **no servidor** e sempre combinado com o ID da revenda autenticada.
- Botão **Ver alterações anteriores**, somente quando a consulta indicar outra página; páginas de até 30 eventos, com busca por ID decrescente (keyset), evitando saltos por alterações novas.
- Contagem explícita dos eventos carregados. Carregamento sob demanda, sem consultar o histórico durante a simples abertura do painel.
- A mudança de produto reinicia a busca; resultados atrasados de filtros, revendas ou papéis antigos são descartados.
- Mensagens de falha preservam páginas previamente carregadas e possibilitam repetir a leitura; o histórico permanece somente leitura.

## Controles preservados
- JWT verificado internamente e membership ativo validado antes de consultar; somente **owner** ou **manager**.
- Sem acesso direto de navegadores ao banco protegido, sem novas permissões, sem gravação/alteração/exclusão pela interface.
- Filtro com formato validado, cursor numérico seguro, limite máximo de 31 linhas obtidas para mostrar 30 e sinalizar página seguinte.
- Sem mexer em pagamentos, taxas, PSP, comissão, pedidos, estoque real ou no mecanismo de auditoria V1.280.
- Histórico anterior à V1.280 não existe e **não é inferido**.

## Verificação
Teste `tests/merchant-catalog-history-pagination-v1-281.mjs` cobre paginação, filtros, isolamento, papéis, cursor inválido, estado assíncrono e injeção de HTML. Teste anterior V1.280 permanece no CI (atualizado para a consulta de 31/30).
