# V1.161 — Conversão em uma jornada contínua

## Problema
A home, a cotação, o formulário opcional de disponibilidade e a entrada da revenda não devem funcionar como fluxos independentes que obrigam o visitante a repetir o CEP ou reconstruir a cesta. O site deve priorizar a próxima decisão realmente necessária e preservar o trabalho já feito.

## Consumidor
- A home valida 8 dígitos antes de encaminhar à consulta ou ao aviso. O campo também aceita Enter.
- O CEP validado passa para o pedido. Se só faltar o número do endereço, a tela o destaca e o foco vai para esse campo.
- A cesta existente não é substituída silenciosamente por P13 quando o cliente volta à home.
- Troca de CEP limpa rua, número, preços, cotações e evidências municipais anteriores, mas preserva os produtos para uma nova busca.
- Sem oferta elegível confirmada para a cesta e o CEP: oferecer aviso opt-in ou nova consulta. Nenhuma alternativa se transforma em compra fictícia.
- O formulário de interesse reaproveita o CEP informado e preseleciona apenas as categorias correspondentes aos produtos do carrinho; o visitante pode alterar as escolhas.
- A rua e bairro continuam confirmados pelo servidor através do CEP; nenhum dado anterior de endereço substitui a validação server-side.

## Revenda
- O CTA da home que expressa interesse em participar leva à página de parceiros e ao formulário de entrada no mesmo clique.
- O cadastro comercial continua exigindo consentimento e não ativa vendas automaticamente. Recebimento, representação legal, documentação, estoque e políticas de produto seguem as etapas próprias.

## Restrições
- Não coletar contato nem registrar lead sem consentimento.
- Não misturar telefones de interesse comercial com dados de entrega sem nova finalidade explícita.
- Não tratar resultados globais de outras cidades como ofertas locais.
- Não afirmar que o pedido foi criado, pago ou entregue antes de confirmação transacional.
- Não perder um carrinho existente por simples navegação nem reutilizar cotação de outro CEP.

## Evidências
Teste de cenário `tests/one-flow-cep-checkout-v1-161.mjs`: preservação da cesta, CEP igual/diferente, invalidação de cotação, seleção correta de SKU, CEP incompleto, foco de intenção de parceiro e seleção de interesses coerente com a cesta. GitHub Actions continua exigindo E2E em 320/360/390 px e verificações financeiras/regulatórias herdadas.

## Próxima hipótese comercial
Validar com visitantes reais se o CEP único reduz o abandono até a cotação; segmentar medição por cidade, disponibilidade real e origem. Não inferir aumento de conversão apenas a partir do teste de usabilidade automatizado.