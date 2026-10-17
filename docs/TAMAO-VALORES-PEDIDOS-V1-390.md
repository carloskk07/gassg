# TAMÃO V1.390 — Valores financeiros confiáveis no cartão da revenda

17/10/2026

## Problema observado

O painel da revenda tinha a expressão `BRL.format(Number(o.totalCents||0)/100)` nos cartões de pedido. Quando o serviço omitisse `totalCents`, a interface transformaria a ausência de informação em **R$ 0,00**, causando a impressão de um pedido gratuito.

O valor informado para troco também utilizava coerção numérica sem verificar integridade. Em respostas incompletas, poderia aparecer como `R$ NaN` ou em outro formato enganoso.

## Correção

- O total só é apresentado como dinheiro quando existe um valor inteiro seguro, não negativo, dentro do limite de apresentação e explicitamente informado em centavos.
- Valor não recebido, em branco, negativo, fracionário ou inválido aparece como **Total não confirmado**.
- Um valor realmente informado como zero é preservado como **R$ 0,00**.
- O valor para troco só é mostrado quando há pagamento em dinheiro e um valor informado válido e positivo, sem coerção de string vazia ou valor lógico em zero.
- O formato de ausência de valor recebeu estilo discreto, legível em celulares pequenos.

## Segurança e limites

A alteração é **somente de apresentação**. Não modifica a cotação, os cálculos de preço, os pedidos, a validação no servidor, o aceite da revenda, o estoque, a autenticação, o reembolso ou a autorização comercial. Nenhuma função Supabase precisa ser implantada nesta versão.

O teste `tests/merchant-verified-amount-v1-390.mjs` foi incorporado ao Audit; ele cobre totais ausentes ou malformados, total zero realmente recebido, total positivo e valor de troco, além de conferir que o painel unificado V1.388 permanece presente.

A integração exige sucesso na auditoria completa e no build isolado dos três portais; a publicação Cloudflare é verificada pelo SHA após merge. Não se presume melhora mensurada de conversão.
