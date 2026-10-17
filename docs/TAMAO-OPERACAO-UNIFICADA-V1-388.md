# TAMÃO V1.388 — Uma visão operacional para a revenda

17/10/2026

## Problema identificado

A evolução V1.386/V1.387 acrescentou atendimentos visíveis à revenda, porém a home operacional já tinha resumo diário, painel de entregas, resumo de atendimento, quadro de chamados pendentes, indicadores da fila e alertas de distribuição. Todos têm utilidade, mas sua repetição na tela inicial aumentava a carga de leitura, principalmente no celular.

## Implementação

**Painel único em “Pedidos que exigem ação”**, com três categorias:

1. **Novos pedidos** — quantidade real na fila, distingue propostas com prazo confirmado das que precisam atualizar. O atalho abre o pedido com prazo válido mais próximo, sem executar aceite nem rejeição.
2. **Entregas** — quantidade em `OUT_FOR_DELIVERY` ou `ARRIVING`; prioriza o pedido com chegada registrada, sem simular GPS ou estimar horários novos. O atalho abre o cartão de entrega.
3. **Atenção** — união sem duplicidades de pedidos `AT_RISK` e pedidos com atendimentos `open`/`in_review`; o texto diferencia incidente operacional de atendimento. Se o suporte não estiver disponível, informa explicitamente que os chamados não foram consultados. O atalho abre o pedido correspondente.

**Redução de ruído visual:** os resumos complementares de entregas e atendimentos foram agrupados dentro de um painel *Ver detalhes e indicadores de pedidos*, inicialmente recolhido. A fila com os pedidos individuais e as verificações de funcionamento continuam acessíveis, e os alertas de atribuição de entregadores seguem visíveis para perfis autorizados.

## Limites e segurança

- As três categorias são calculadas exclusivamente a partir da instância de pedidos recebida de `merchant-orders`, com `merchantOrderListEvidence` recente, identidade da revenda correspondente e papel `owner`, `manager` ou `operator`.
- O navegador não chama tabela ou novo endpoint de suporte. Entregadores continuam na tela própria, sem essa apresentação.
- Os atalhos usam UUID válido ou navegação interna para localizar o pedido; **nenhum botão envia resposta, pagamento, PIN, aceite ou alteração financeira**.
- Os totais mostram apenas a lista carregada, que pode ter sido alterada após a consulta.
- Os estados de autorização comercial, estoque, comissão, descontos, pagamento e demais ações continuam controlados pelo backend existente.

## Validação

`tests/merchant-unified-workspace-v1-388.mjs` valida prioridade por oferta e chegada, total de problemas sem duplicação de pedidos, ausência de dados privados, papéis, troca de revenda, leitura vencida/sem conexão, UUIDs inválidos, layout mobile e preservação das funcionalidades anteriores.

Executar `Audit` e `Build isolated live portals` antes da integração. Após o merge, verificar publicação Cloudflare, prontidão e reconciliação por commit SHA.

A simplificação é uma melhoria de interface; benefícios de conversão ou produtividade não serão declarados sem medições reais.
