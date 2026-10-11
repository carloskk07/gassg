# TAMÃO V1.164 — Confiança após a escolha da oferta

## Problema
O comprador precisava distinguir oferta enviada, revenda que aceitou, saída confirmada, chegada, recebimento e conciliação. Um selo genérico "AO VIVO", prazo fixo de três minutos e descrições de agendamento podiam induzir a acreditar que havia compromisso antes das provas reais.

## Regras de UX
1. A fonte de cada etapa é o **status retornado do pedido**; não usar previsão de entrega como evento e não inventar atualização em tempo real.
2. O status pendente comunica que a revenda ainda precisa confirmar o atendimento, com prazo do backend quando disponível — nunca duração fixa embutida no texto.
3. A tela apresenta quatro marcos de fácil entendimento: pedido enviado, revenda aceitou, saída confirmada e recebimento registrado. O marco de recebimento não equivale à conciliação financeira.
4. Em risco, reatribuição ou cotação alternativa, mostrar o próximo passo humano sem fingir que o entregador já saiu. Eventos efetivos permanecem no histórico auditável.
5. Uma proposta alternativa sempre exibe valor anterior, valor novo e aceite explícito. Proposta expirada não pode ser aceita pelo controle da interface; a validação final permanece no servidor.
6. O PIN aparece somente após saída confirmada (OUT_FOR_DELIVERY/ARRIVING). Explicar ao cliente que não deve enviar o código antes de receber e conferir o pedido.
7. O pagamento é feito à revenda; a plataforma não recebe a venda para depois repassar. O status financeiro só avança segundo a confirmação no servidor.
8. Uma janela de entrega solicitada não é apresentada como aceitação do pedido. O mesmo vale para indicação de economia: diferença para maior proposta não vira desconto garantido.
9. Falha de sincronização mostra o último estado confirmado e convida a atualizar, sem selo "AO VIVO" ou ações que suponham conectividade.
10. Links de ações sensíveis não interpolam IDs de pedidos vindos do servidor nos atributos executáveis.

## Funcionalidades preservadas
- Histórico de eventos confirmados e dados mínimos do pedido.
- Pedido aceito, risco, reatribuição, reprecificação, cancelamento pré-despacho, expiração e suporte.
- Código PIN somente na fase correta; feedback depois da liquidação.
- QR/PSP e confirmação de Pix/cartão somente quando verdadeiros; recebimento permanece na revenda.
- Responsividade com marcos e botões em 320/360/390 px, foco e redução de movimento.

## Verificações
`tests/customer-tracking-confidence-v1-164.mjs` cria estados sintéticos para todas as etapas e renderiza HTML real sem chamar provedores. Valida evidência de PIN, reprecificação com prazo vencido, segurança dos botões, status offline, dados escapados e suporte. Auditoria completa via CI, inclusive E2E móvel.

## Limites
A implementação é de interface e testes; não concluiu pedidos nem homologou PSP ou revenda real. Manter PR draft e dependências até integração planejada.
