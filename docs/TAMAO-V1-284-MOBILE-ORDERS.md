# TAMÃO V1.284 — pedidos mais legíveis no celular

A V1.283 mantém atalhos para o próximo controle autorizado. A V1.284 prioriza o que a equipe precisa enxergar durante o atendimento, sem inventar prazos nem criar uma segunda máquina de estados.

## Interface
- Cartão exibe a situação atual em destaque: aguardando resposta, aceito, preparação, imprevisto, em entrega ou chegada informada.
- Se há um horário válido recebido do servidor, apresenta **limite da oferta**, **prazo de saída** ou **previsão de entrega**; se o horário já passou, informa que a referência passou, sem afirmar que o pedido foi atrasado ou cancelado.
- Não mostra data inválida, muito antiga ou exageradamente futura, e não cria estimativas quando faltam informações.
- Em telas estreitas, melhora hierarquia de código do pedido, produtos, valor, situação, prazo e botões com áreas de toque adequadas.
- Mantém o acompanhamento de etapas no painel recolhível já existente e acessível, inclusive o modo aberto em imprevistos.

## Salvaguardas
- Os dados continuam sendo os da revenda autenticada, sem chamadas adicionais ao backend.
- Endereços e contatos continuam com a proteção existente: nenhum dado oculto é introduzido no resumo compacto.
- Não altera aceite, despacho, cobrança, marcação de recebimento, PIN, atribuição de entregas, comissão ou processamento de pedidos.
- Teste `tests/merchant-order-mobile-v1-284.mjs` verifica rótulos por estado, prazos válidos/expirados, datas suspeitas, privacidade, XSS e os controles originais.
- Exigir Audit, build de produção, teste móvel e confirmação do mesmo SHA nos três portais.

Sem migração no Supabase.
