# V1.160 — Conversão personalizada por cidade, com fonte real

## Intenção
Fazer cada visitante se sentir recebido na própria cidade, mas sem transformar a presença global de revendas em promessa de ofertas para aquele endereço.

## Contratos
- Sem cidade confirmada: a página convida a informar o CEP, sem fixar São Gabriel como padrão.
- Cidade confirmada por um cadastro consentido ou pela validação de CEP do servidor: saudação personalizada e rodapé por município/UF.
- Uma cidade lembrada não confirma disponibilidade. Só uma consulta autenticada do backend e cotações válidas para aquele CEP permitem afirmar que houve ofertas.
- Evidência de cotação é transitória, associada ao CEP exato e sujeita à validade das ofertas. Uma revenda global não prova um fornecedor para a cesta daquele cliente.
- Quando a consulta retorna zero ofertas, a home apresenta um convite opcional para receber aviso, sem criar pedido e com consentimento.
- Se o cliente digitar um novo CEP, a tela de aviso não fica presa no sucesso da cidade anterior.
- A vitrine principal prioriza P13 se presente no catálogo operacional configurado; do contrário usa um produto real não oculto da lista, sem criar P13 escondido no carrinho.
- O processamento do pedido, cobrança, elegibilidade por produto, regulamentação GLP, aceite e PIN permanecem no backend.
- Não assumir localização por IP, navegador, preferência ou geolocalização aproximada; não inventar revendas, preços, fotos, prazos ou avaliações.

## Provas
Novo teste de unidade e de contratos para cache CEP, troca de município, seleção de produto, bloqueio de falsa revenda única e neutralidade na comunicação de abastecimento. Auditoria completa de navegador 320/360/390 px e fluxos operacionais permanece exigida no GitHub Actions.

## Publicação
Feature branch empilhada na versão de comunicação V1.159, sem ativação de comércio nem modificação permanente da base.