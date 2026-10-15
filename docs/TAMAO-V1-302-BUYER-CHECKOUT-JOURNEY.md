# TAMÃO V1.302 — Jornada de compra em poucos passos

A tela do cliente passa a explicar o próximo passo real: Produtos, Endereço, Contato e Opções. O progresso usa somente dados do checkout já existentes e preços não expirados. Nunca representa um pedido como concluído ou uma entrega como garantida.

## Usabilidade
- Um botão contextual direciona ao local correto da tela e, quando necessário, posiciona o foco no CEP ou telefone.
- Pedidos já em andamento recebem acesso ao acompanhamento, não uma promessa de novo pedido.
- Complemento, referência e recado ficam opcionais e recolhidos por padrão; valores anteriores abrem automaticamente os campos.
- O telefone permanece visível e exigido pelo checkout antes da criação do pedido.
- A área de comparação continua mostrando preço total com entrega, prazo, pagamento à revenda e condições de aceite.

## Segurança e operações
O navegador não habilita cidades, revendas, PSPs ou permissões. O servidor continua responsável pela validação de endereço, ofertas, pagamentos, preços, estoque e criação de pedido. O contrato de cancelamento e pagamento direto foi preservado. Nenhum cron ou recurso financeiro foi ativado.

## Verificação e continuidade
Testes de estados vazio, endereço, telefone, carregamento, ofertas, pedido em andamento, navegação, foco, responsividade e regressões existentes. Próximas frentes: V1.303 produtividade do parceiro e V1.304 inventário de liberações controladas pelo admin.