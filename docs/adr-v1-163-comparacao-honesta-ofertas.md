# TAMÃO V1.163 — Comparação de ofertas sem atrito

## Problema
A tela exibida no celular concentrava preço, prazo, confiança e vários indicadores em um cartão pequeno. O valor após cashback aparecia antes de explicar o total real da oferta, e o texto “economiza” podia ser interpretado como desconto garantido quando representava somente a diferença para a maior proposta da consulta.

## Experiência pública
- As ofertas começam com uma introdução que confirma a quantidade efetivamente retornada pelo servidor, sem criar oferta fictícia.
- O card prioriza o **total com entrega**, depois o **prazo estimado**, a forma e o destinatário do pagamento.
- O desmembramento **produtos + entrega** só aparece se a parcela da entrega do candidato reconciliar matematicamente com a cotação oficial. Caso contrário, a tela informa somente o total.
- Cashback solicitado é mostrado em separado, identificado como **estimativa sujeita a confirmação na criação do pedido**. O valor total original continua visível.
- A informação de “economia” é explicitamente relativa à oferta mais cara daquela consulta; não representa desconto especial, promoção ou preço de mercado.
- O fluxo oferece ordenação local por **sugestão**, **menor total** ou **menor limite superior do prazo**. Ordenar não altera o ranking do backend, não cria nova cotação e não pede permissão financeira.
- Os indicadores detalhados de reputação ficam disponíveis em “Por que esta opção apareceu?” em vez de competir com o preço e o botão principal.
- O CTA comunica sua consequência: **Enviar pedido para confirmação**. A revenda ainda precisa aceitar.
- Identificador de cotação inválido nunca é interpolado no atributo executável; o botão fica desabilitado.

## Segurança e invariantes
1. Identidade da revenda permanece anônima antes de aceite. Nenhuma nova informação pessoal é liberada na resposta de ofertas.
2. O preço e a taxa de entrega não são reconstituídos com valores fixos do cliente: partem dos valores confiáveis do servidor. Cobrança e confirmação final continuam no backend.
3. Benefícios, prazos e avaliações exibidos dependem do que existe nas ofertas reais; não criamos selos nem avaliações sintéticas para visitantes.
4. O total apresentado não é uma autorização de débito; nenhuma tela de comparação realiza pagamentos. A venda continua diretamente entre cliente e revenda.
5. A ordenação de opções não afrouxa restrições por cidade, produto, ANP, disponibilidade, pagamento ou expiração de quote.
6. Empates de preço/prazo não ganham um selo de liderança artificial.

## Verificação
Contrato de testes executável `tests/transparent-offer-comparison-v1-163.mjs`: ordenação estável, preservação da sugestão original, empate, soma de produtos/entrega, cashback condicional, destinatário do pagamento, validade dos botões, prevenção de script em quoteId e UI responsiva. Auditoria de navegador em 320, 360 e 390 px permanece obrigatória.

## Publicação
PR draft empilhada em V1.162 e anteriores. Não confundir testes de renderização com homologação de pagamentos ou aumento medido na conversão.
