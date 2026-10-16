# TAMÃO — V1.341 Vitrine por cidade: referências transparentes → preços reais

Data: 16 de outubro de 2026. Escopo: domínio público do cliente `tamao.com.br` e Supabase.

## O problema

A primeira visita mostrava indicadores precoces de indisponibilidade, exigia o CEP na abertura e escondia a comparação de preços em cidades sem revendas. O cliente precisava fornecer o endereço antes mesmo de conhecer o valor da plataforma, enquanto produtos/benefícios eram menos visíveis.

## Nova experiência

- **Descobrir primeiro, informar CEP ao pedir.** A página inicial abre a vitrine, oferece um resumo e permite escolher produtos. O campo CEP permanece opcional e recolhido; a confirmação do CEP e da entrega continua obrigatória no fluxo de cotação/pedido.
- **Cidade personalizada com origem explícita.** Uma consulta por CEP previamente validado tem precedência. Se o visitante tiver selecionado uma cidade, ela é lembrada somente para a vitrine. Na primeira visita sem localização verificada, São Gabriel/RS é a **vitrine inicial**, nunca apresentada como geolocalização do usuário. O visitante pode trocar cidade e UF no próprio site, sem alterar endereço ou CEP de entrega.
- **Faixa local verdadeira em São Gabriel.** Enquanto não houver preços reais elegíveis, três cartões exibem mínimo R$ 115,90, usual R$ 120,00 e máximo R$ 125,00 para o mesmo P13. A faixa já existia no projeto. **Não são três comerciantes, não são ofertas compráveis, e a entrega citada pertence apenas à referência.** Outros produtos ou cidades sem dados não recebem preços inventados.
- **Mudança automática para valores de revendas.** O RPC `public_city_price_board_v1_341` retorna valores agregados por produto `min`/`max` e número de revendas somente para itens ativos, em estoque, com preços frescos, de revendas que passam `market_city_offer_scope` e o requisito de conformidade da cesta. Esse escopo aplica as autorizações de cidade, modo de operação, disponibilidade, requisitos financeiros e limites de compliance existentes. A função é apenas informativa e não gera cotação, autorização de compra ou oferta reservada.
- **Atualização da vitrine.** O cliente autenticado anonimamente no fluxo existente consulta o RPC após a inicialização e, enquanto estiver ativo, revalida periodicamente os preços (janela de 90 segundos). A troca de cidade descarta a vitrine anterior; respostas de outra cidade são rejeitadas. `get-offers` e as regras originais de validação continuam determinando os preços **finais e compráveis** para CEP/cesta/endereço.
- **Estilo mais envolvente sem dados falsos.** Cartões com hierarquia de preços, cor para referências versus revendas, layout responsivo, transições discretas e suporte a `prefers-reduced-motion`. A tela pública não mostra barra de indisponibilidade durante o carregamento de sessão normal; erros de origem insegura e bloqueios de compra permanecem.

## Proteções verificáveis

Nenhuma referência é inserida em `liveRuntime.offers`, `quoteId`, estoque, vendas, checkout ou `create-order`.

O RPC é `STABLE SECURITY DEFINER`, recebe somente cidade e UF, sem CEP, telefone ou localização GPS. `anon` não pode executar; `authenticated` e `service_role` podem receber somente agregados sobre cidades comercialmente habilitadas. Cidades fechadas retornam lista vazia de revendas e nunca parecem operar.

Não há contadores falsos de pedidos, cronômetros fictícios, reputações inventadas, preços comerciais de outras cidades, nem três supostos vendedores para a faixa P13.

## Limitações conhecidas

A seleção automática da cidade na primeira visita sem histórico depende de uma fonte de geolocalização confiável ainda **não implantada**. Por isso, o site usa São Gabriel como vitrine e exibe a origem; não afirma detectar a localização exata via IP. Uma localização nova é selecionada pelo visitante, ou recuperada de CEP validado anteriormente.

A agregação pública fornece produto + taxa de entrega configurada **preliminar**; o preço final pode depender de endereço exato, opção de pagamento, modalidade e demais condições comerciais. Só a resposta autorizada de `get-offers` permite avançar para o pedido.

O mercado de produção continua em pré-lançamento enquanto não houver autorização explícita do administrador. Na inspeção inicial, havia uma revenda cadastrada, mas nenhuma abertura comercial executada.

## Testes e implantação

- `tests/customer-city-price-showcase-v1-341.mjs`: valores reais por cidade, referência local, isolamento de UF/cidade, troca entre modos, ausência de cotação falsa, troca de cidade sem sobrescrever CEP e consulta com cache de atualização.
- `tests/first-visit-clarity-v1-167.mjs`: texto de abertura ajustado sem desativar os controles de compra.
- Fluxo auditado e build dos portais no GitHub Actions.
- Aplicar migração somente após auditoria e integrar PR à `main` sem alterações financeiras ou abertura de cidade.
