# TAMÃO V1.381 — Oferta clara antes da solicitação

Data: 17/10/2026

## Problema e objetivo

A comparação de ofertas já distingue total, taxa de entrega e prazo estimado, mas a jornada ainda deve explicar melhor que o clique **envia uma solicitação** e não representa um pedido aceito ou uma entrega garantida. A camada de apresentação também usava `Number(o.total)||0` e previsões com valores padrão: na falta de informação adequada, o visitante podia visualizar um preço R$ 0,00 ou prazo artificial. Métricas de revendas malformadas poderiam aparecer como `NaN%`.

## Implementação V1.381

- Cada comparação passa a explicar em três etapas: o cliente envia uma solicitação; a revenda precisa aceitar; após o aceite o cliente acompanha o andamento e paga diretamente à revenda, de acordo com a opção selecionada.
- Os cartões evidenciam o valor total da cesta com a entrega e a previsão de entrega, com disposição responsiva. O botão continua **Enviar pedido para confirmação**, sem diálogo ou clique extra.
- A ausência de valor total positivo e finito, de prazo estimado não negativo com limite válido ou de identificador seguro desativa a ação. Os textos mostram **Total indisponível** ou **Prazo indisponível**, em vez de oferecer números supostos.
- Comparações sumarizadas desconsideram totais ausentes/zero e prazos vazios; não há vencedores fictícios.
- Métricas de desempenho só aparecem quando têm valores numéricos válidos e percentuais dentro da faixa 0–100. A condição operacional não recebe rótulo genérico de disponibilidade se o servidor enviar classificação desconhecida.
- O cashback permanece explicitamente uma estimativa e a confirmação do benefício continua na criação do pedido.

## Integridade comercial e operacional

Não foram alterados: Supabase, cálculo do preço no servidor, validade da cotação, regras para aceitar ou rejeitar pedidos, pagamento, compensação de benefícios, comissão, autorizações administrativas ou ativação de cidades.

## Validação

- `tests/checkout-offer-confidence-v1-381.mjs`: fluxo solicitação→aceite→acompanhamento, valores reais, prazo, pagamento, moedas e exceções de campos nulos/malformados; responsividade e ausência de novas ações financeiras.
- Testes legados V1.163, V1.351, V1.380 e auditoria geral.
- Build isolado de três portais e revisão dos testes mobile. Publicação Cloudflare só pode ser afirmada depois da reconciliação do commit em `main`.

Aumento de CTR/conversão exige medição real; a atualização não atribui ganho sem evidência.
