# TAMÃO V1.281 — consulta de histórico por produto e páginas

A V1.280 criou uma trilha de alterações realmente confirmadas, iniciada na implantação. A V1.281 melhora a consulta do proprietário e gerente sem modificar a gravação transacional.

## Implantação de baixo risco

A V1.281 usa a Edge Function isolada \`merchant-catalog-history\`, versão 1, já implantada sem alterar a função \`merchant-ops\` versão 44. O painel consulta o serviço separado somente depois da ação do usuário. A autorização verifica token de usuário permanente pelo Auth, associação ativa com a revenda e papel owner/manager em cada chamada. \`verify_jwt = false\` apenas desativa a verificação prévia da plataforma; o endpoint verifica o JWT internamente por \`auth.getUser()\`. Nenhum acesso direto ao histórico foi concedido a clientes.

## Mudanças
- Filtro opcional por produto, aplicado **no servidor** e sempre combinado com o ID da revenda autenticada.
- Botão **Ver alterações anteriores**, somente quando a consulta indicar outra página; páginas de até 30 eventos, com busca por ID decrescente (keyset), evitando saltos por alterações novas.
- Contagem explícita dos eventos carregados. Carregamento sob demanda, sem consultar o histórico durante a simples abertura do painel.
- A mudança de produto reinicia a busca; resultados atrasados de filtros, revendas ou papéis antigos são descartados.
- O histórico no navegador é vinculado ao **usuário autenticado** e à revenda. Trocar de conta, encerrar a sessão ou receber uma resposta de sessão anterior não reaproveita informações da pessoa anterior.
- Mensagens de falha preservam páginas previamente carregadas e possibilitam repetir a leitura; o histórico permanece somente leitura.

## Controles preservados
- JWT verificado internamente e membership ativo validado antes de consultar; somente **owner** ou **manager**.
- O sign-out invalida operações de histórico pendentes e limpa imediatamente o estado do histórico da sessão anterior.
- Sem acesso direto de navegadores ao banco protegido, sem novas permissões, sem gravação/alteração/exclusão pela interface.
- Filtro com formato validado, cursor numérico seguro, limite máximo de 31 linhas obtidas para mostrar 30 e sinalizar página seguinte.
- Sem mexer em pagamentos, taxas, PSP, comissão, pedidos, estoque real ou no mecanismo de auditoria V1.280.
- Histórico anterior à V1.280 não existe e **não é inferido**.

## Verificação
Teste `tests/merchant-catalog-history-pagination-v1-281.mjs` cobre paginação, filtros, isolamento, papéis, cursor inválido, estado assíncrono e injeção de HTML. Teste anterior V1.280 permanece no CI (atualizado para a consulta de 31/30).
