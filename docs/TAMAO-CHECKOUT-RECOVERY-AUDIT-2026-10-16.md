# TAMÃO — Auditoria da recuperação de checkout (16/10/2026)

## Falha comprovada pelo código
O frontend `liveCreateOrder` usava `liveRuntime.orderId` como prova de que a tentativa atual de compra fora bem-sucedida sempre que `create-order` ou o carregamento posterior falhasse. Esse ID pode pertencer a um pedido anterior; `liveSyncFinancialProfile` pode mantê-lo. O fluxo anterior então apagava a cesta e exibia a mensagem 'Pedido recuperado com segurança' mesmo sem vincular o pedido ao checkout atual.

**Risco ao consumidor:** impressão falsa de pedido enviado, perda da cesta original e navegação para pedido antigo. Não há evidência de ocorrência em produção: o banco consultado não possuía pedidos reais.

## Correção
- Armazena a identidade do pedido acompanhando **antes** de iniciar o checkout.
- Só trata a compra como definitivamente registrada se `create-order` retornar uma identificação UUID válida. Uma falha ao carregar os detalhes desse pedido confirmado passa a mostrar acompanhamento temporariamente indisponível, sem instruir uma nova compra.
- Após resposta de rede ambígua **sem confirmação**, uma consulta só identifica como novo um pedido ativo diferente do ID anterior. Mostra a necessidade de o cliente conferir o acompanhamento, sem afirmar que o checkout atual foi aceito.
- Em falha não reconciliada preserva a cesta e não apresenta pedido antigo como recém-criado.
- Mantém as chaves de idempotência da tentativa e as regras autoritativas de banco, sem modificar políticas de pagamento, despacho, estoque ou ativação comercial.

## Testes
`node tests/customer-checkout-ambiguous-recovery.mjs` exerce cinco cenários:
1. Falha de rede com ID de pedido antigo.
2. Pedido realmente registrado com falha posterior na leitura dos detalhes.
3. Pedido ativo diferente descoberto após resposta ambígua.
4. Resposta inválida sem identificador de pedido.
5. Pedido normal confirmado e recuperável.

A suíte foi incluída no workflow `Audit` e deve passar antes de integrar à `main`. A publicação Cloudflare requer checagem posterior do SHA nos três portais.

## Limitações
O diagnóstico é determinístico e não autoriza criar pedidos, ativar comércio, cobrar clientes ou disparar notificações. A recuperação de resposta perdida pode exigir inspeção humana se não houver uma prova identificável de idempotência. Teste E2E real só depois dos requisitos administrativos/comerciais e de um cenário controlado.
