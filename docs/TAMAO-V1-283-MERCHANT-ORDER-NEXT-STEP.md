# TAMÃO V1.283 — próximo passo do pedido em um toque

## Objetivo
Reduzir navegação manual sem reduzir proteções. O resumo diário V1.271/V1.282 já escolhe o pedido prioritário. A V1.283 altera apenas o **destino do botão**, para o controle existente que a revenda deve conferir.

## Fluxo
- **Oferta nova:** abre o card e foca o botão **Aceitar pedido**, quando a oferta não estiver vencida; nunca aciona o aceite.
- **Preparação:** para proprietário/gerente, se falta responsável e o seletor está disponível, abre a atribuição antes da saída; caso contrário, aponta para o controle de saída, somente quando habilitado.
- **A caminho:** aponta para **Estou chegando**, sem registrar chegada.
- **Chegando:** primeiro aponta para **Pagamento recebido** (sem marcar); depois para o PIN; somente quando ambos estão preenchidos pode apontar para o botão de conclusão.
- **Imprevisto e pedido aceito:** mostra o card para análise, sem antecipar ações potencialmente irreversíveis.
- **Oferta vencida, saída agendada ainda bloqueada, botão indisponível:** navega para o pedido, sem induzir que uma ação está liberada.

## Restrições
- Revalida o ID UUID, revenda autenticada ativa, papel operacional e presença do pedido na lista autorizada atual.
- Abre seções recolhidas e movimenta apenas foco e rolagem no navegador.
- Não chama o backend de pedidos nem modifica status, pagamentos, PIN, estoque, comissão ou repasse.
- Confirmações, versão esperada e regras do servidor permanecem nos botões originais.
- Teste `tests/merchant-next-step-v1-283.mjs` cobre papéis, IDs, pedidos de outra sessão, prazos vencidos, controles bloqueados e sequência pagamento/PIN.

## Publicação
É uma mudança do frontend. Exigir Audit, build isolado, testes de navegador móvel, merge e verificação de SHA dos três portais. Nenhuma migração ou Edge Function é necessária.
