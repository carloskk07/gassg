# TAMÃO V1.273 — Muitas entregas, uma tela simples

Esta evolução melhora o painel operacional da revenda e do motorista quando existem **duas ou mais entregas em andamento**. Mostra uma lista compacta de até seis entregas, priorizando as que estão aguardando conferência (ARRIVING), depois as que têm previsão registrada ultrapassada, próximas de vencer e sem previsão. Os rótulos são baseados apenas no estado do pedido e nas datas recebidas do servidor; previsões não são fatos de entrega.

**Ações:** Ver pedido, que apenas leva ao cartão da fila; Abrir rota e Ligar para cliente, reutilizando a política V1.272 e aparecendo apenas se o backend permitir visualizar endereço e detalhes de contato no estágio de entrega. Existe um atalho para a fila completa e aviso sobre entregas adicionais. Nenhum pedido é ocultado da fila.

**Autoridade:** a lista utiliza exatamente os pedidos da sessão autenticada que o backend já expõe. Motoristas não recebem dados de outras rotas. Nenhuma confirmação de PIN, recebimento, saída ou entrega é efetuada pelo resumo. Não foram alterados banco, APIs, pagamentos ou autorizações.

**Validação:** `tests/merchant-multi-delivery-board-v1-273.mjs` cobre ordenação, limites, alertas, privacidade, perfis, escape XSS e ausência de mutações; audit geral, build e mobile E2E.
