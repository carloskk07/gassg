# TAMÃO V1.333 — Auditoria da maturação das comissões

Data: 16 de outubro de 2026.

## Falha confirmada

O cron `chama-reward-maturation` executa `public.process_reward_maturation()` às 23 minutos de cada hora. A função selecionava as 100 concessões de indicação mais antigas com prazo vencido e só depois, dentro do loop, confirmava:
- Pedido `SETTLED`, situação financeira `settled`;
- Revisão de risco `clear` ou `approved`;
- Indicado e indicador com contas existentes e não anônimas;
- Valor pendente, concessão ainda não maturada nem revertida.

**Se 100 concessões antigas estivessem em revisão, com identidade inválida ou sem estado financeiro apto, a fila limitava a busca a essas 100 em todas as execuções.** Todas eram ignoradas dentro do loop, e uma comissão válida na posição 101 não era selecionada. A existência de índice por `commission_available_at` não resolve o problema lógico.

## Evolução

Mover as condições mínimas de elegibilidade para a consulta antes do `LIMIT 100`, usando `JOIN` em pedidos, revisões e contas dos dois participantes.

As mesmas verificações originais são mantidas dentro da operação, com `pg_advisory_xact_lock`, `SELECT ... FOR UPDATE` e lançamentos idempotentes no livro `wallet_entries`. Isso impede que uma seleção inicialmente elegível burle mudanças concorrentes de situação.

A ordenação da fila agora é determinística por `commission_available_at,order_id`. O lote continua com até 100 comissões por execução e a programação cron não muda. Comissões não elegíveis permanecem bloqueadas, sem liberação automática e sem burlar a análise de risco.

## Evidência de testes

`tests/reward-maturation-eligible-queue-v1-333.mjs`:
- 100 comissões antigas em revisão não impedem uma comissão 101 aprovada;
- contas anônimas, revisão rejeitada, estornos, pedidos não liquidados e prazo futuro ficam fora da seleção;
- conferência de que as travas por pedido, a revalidação dentro da transação e os lançamentos com chave idempotente permanecem;
- processamento máximo de 100 concessões selecionadas por rodada.

Teste integrado ao workflow Audit.

## Produção, segurança e limites

No momento da auditoria, havia zero pedidos, concessões, lançamentos de carteira, revisões e comprovantes externos de repasse. Não foram criadas vendas, comissões ou pagamentos. A comercialização de São Gabriel continua desabilitada.

Os testes de simulação e a auditoria estática demonstram a prevenção de **bloqueio de fila**; não demonstram recebimento externo de comissão, análise de fraude real nem end-to-end com PSP. Validar a migração no banco por `pg_get_functiondef`, rever advisors e confirmar `PRELAUNCH` após publicar.
