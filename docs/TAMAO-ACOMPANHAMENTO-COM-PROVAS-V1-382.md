# TAMÃO V1.382 — Acompanhamento comprovado antes da decisão

17/10/2026

## Problema observado

A tela de acompanhamento já distingue aceite da revenda, imprevistos, troca de oferta, saída, recebimento e conciliação. Entretanto, o cálculo da contagem regressiva de uma proposta usava diretamente `Date.parse` seguido de `Math.max`, o que podia resultar em `NaN` quando a data estava ausente ou malformada. Além disso, a proposta era apresentada para aprovação com o botão ativo mesmo quando não havia consulta recente, data de expiração comprovada ou total anterior válido.

No resumo do pedido, `Number(o.totalCents||0)/100` substituía dados financeiros ausentes por R$ 0,00. O mesmo ocorria nos totais individuais de itens com valor não informado.

## Alterações V1.382

- Data de expiração interpretada somente quando existe timestamp ISO utilizável, sem limites temporais absurdos; a ausência/erro retorna estado **desconhecido** em vez de criar prazo inventado.
- Proposta pode receber decisão somente quando existe total anterior válido, total proposto positivo, prazo comprovado e ainda vigente, e leitura recente daquele pedido sem falha. A indisponibilidade da leitura apresenta a instrução **Atualize antes de decidir**.
- Link prioritário de proposta não leva à aprovação quando o prazo está expirado, desconhecido ou quando o preço proposto não é um inteiro positivo em centavos. O botão de atualização permanece disponível.
- Valores totais e valores de itens só aparecem como quantias quando o servidor os fornece em centavos inteiros, seguros e dentro do intervalo permitido; ausência de dados vira **Valor não confirmado**, nunca uma falsa oferta gratuita.
- Os cartões de reavaliação e resumo financeiro receberam uma hierarquia mais legível em telas pequenas, inclusive botão desativado e motivos de atualização.

## Segurança preservada

Nenhuma alteração nas Edge Functions, nos eventos oficiais, nas regras de cancelamento, em autorização de revendas, nas funções financeiras, na criação ou aceitação de pedidos ou nos mecanismos de atendimento. O backend continua a validar novamente o estado do pedido na criação de qualquer ação. Esta atualização apenas reduz decisões baseadas em dados obsoletos e melhora a comunicação.

Atenção: não se atribui desempenho em tempo real sem leitura confirmada, e não se confirma reembolso, substituição de revenda ou entrega por inferência.

## Validação

- Novo `tests/buyer-tracking-proof-v1-382.mjs`, no Audit: prazos inválidos e expirados; proposta sem preço; leitura desatualizada, erro de conexão; registro financeiro ausente; total realmente zero versus dado não recebido; proteção do PIN e estados de atendimento.
- Regressões V1.164, V1.179 e V1.352, builds dos três portais e E2E mobile do repositório.
- Confirmar Cloudflare via SHA da `main` após integração, sem confundir êxito do GitHub com entrega final aos visitantes.

Melhora esperada: clareza e prevenção de ações confusas, sem alegação de aumento de conversão até medição real.
