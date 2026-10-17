# TAMÃO V1.389 — Recuperação de ofertas sem prazo válido

17/10/2026

## Diagnóstico

A V1.388 reúne novos pedidos, entregas e atendimentos em um quadro principal. Identifiquei uma situação em que a apresentação induzia a um beco sem saída: caso existissem ofertas `OFFERED_TO_MERCHANT` cujo prazo estivesse vencido, ausente ou inválido, o cartão informava que a lista precisava de atualização, mas mostrava **Sem ação nesta categoria agora** em vez de oferecer a consulta.

Isso poderia dificultar o primeiro uso do painel, sobretudo em celulares e após interrupção de conexão, embora o backend continuasse corretamente protegido contra aceite fora do prazo.

## Correção

- Se há apenas ofertas sem prazo aproveitável, o cartão traz **Atualizar ofertas para decidir**. O botão apenas chama a atualização normal do painel; não aceita, rejeita, reserva nem altera nenhum pedido.
- Se existem ofertas com prazo válido e outras sem prazo, a ação principal continua sendo **Ver pedido para aceitar**, direcionada à oferta válida mais próxima do vencimento. Surge um segundo controle, **Atualizar outras ofertas**, para recuperar o restante sem esconder o trabalho disponível.
- Quando todas as ofertas têm prazo utilizável, nenhum botão adicional de recuperação aparece.
- A mensagem explica quantas ofertas não têm prazo válido para aceite e quantas têm prazo comprovado nesta consulta, sem presumir que uma oferta vencida seja automaticamente recuperável.
- Estado pendente desabilita atualização repetida. A UI continua dependendo da sessão, revenda selecionada, papel autorizado e dados recentes da mesma instância de lista retornada pelo servidor.
- Ajustes responsivos, foco visível e botão de toque adequado.

## Limites de segurança

A função `merchantLiveRefresh()` é utilizada exclusivamente para recarregar dados; o aceite real segue a validação de prazo, versão, identidade e estado do backend. Não há mudança em Supabase, RLS, Edge Functions, pagamentos, comissões, taxas, abertura de cidades ou autoridades do administrador.

## Testes

- `tests/merchant-offer-recovery-v1-389.mjs`: todas as ofertas inválidas/vencidas, parte das ofertas com prazo, todas válidas, lista vazia, atualização pendente, revenda trocada, conta de entregador, snapshot antigo e proteção contra execução implícita de pedido.
- Contrato de clareza atualizado no teste V1.388.
- Auditoria completa e construção dos três portais são obrigatórias antes do merge.
- Publicação Cloudflare deve ser confirmada pela versão exata da `main`, não inferida da aprovação da PR.

Nenhum resultado de conversão é afirmado sem medição em operação.
