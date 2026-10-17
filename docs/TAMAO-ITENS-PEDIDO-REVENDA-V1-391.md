# TAMÃO V1.391 — Itens do pedido exibidos sem quantidades inventadas

17/10/2026

## Diagnóstico

O cartão do pedido da revenda usava `Number(i.quantity)` diretamente na composição dos itens. Se o backend trouxesse um item sem quantidade válida, a interface podia mostrar `NaN×`, `0×` ou outra quantidade enganosa. Listas ausentes também eram tratadas como uma simples descrição genérica sem explicar a necessidade de conferência.

A V1.390 já protegia os valores monetários do pedido. A V1.391 aplica a mesma transparência às **quantidades e descrições dos itens**.

## Melhoria

- Quantidades só são apresentadas quando explicitamente informadas como números inteiros positivos e seguros, dentro do limite de apresentação. Strings numéricas canônicas são aceitas.
- Quando a quantidade estiver ausente ou inválida, a UI mostra **Quantidade não confirmada**, preservando o produto identificável.
- Quando a identificação do produto estiver ausente ou malformada, mostra **Produto não identificado**.
- Lista ausente ou vazia indica **Itens não confirmados nesta consulta**, sem presumir que o pedido seja gratuito ou não tenha produtos.
- Para evitar excesso de HTML, são exibidos até 50 itens na visão compacta; se houver mais, a tela informa que a lista está incompleta.
- A orientação **Confira os itens deste pedido** recomenda atualizar a fila antes de decidir. Não cria ou altera quantidades e não substitui a confirmação pelo servidor.
- Foco mobile em legibilidade, quebra de texto, número tabular e mensagens acessíveis.

## Segurança e isolamento

Não há mudança no Supabase, Edge Functions, aceites, pagamentos, taxas, comissões, permissões, autorização de cidades ou critérios reais de oferta. O sistema mantém as ações oficiais e a validação backend intactas. Textos de produtos são escapados antes de entrar no HTML.

## Verificação

`tests/merchant-item-integrity-v1-391.mjs` cobre quantidade válida, ausência, zero, negativo, decimal, NaN, limites de apresentação, descrição malformada, HTML injetado como texto, lista vazia, muitos itens, estabilidade de ações e estilo mobile. O teste está integrado ao Audit, junto das regressões V1.388–V1.390.

Integrar somente após auditoria e build dos três portais. Após o merge, verificar publicação Cloudflare pelo commit da `main`, sem confundir resultado de CI com entrega confirmada.
