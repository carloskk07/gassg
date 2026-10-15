# TAMÃO V1.275 — Conclusão de entrega guiada no celular

**Problema resolvido:** o botão de finalizar a entrega podia ser acionado antes de preencher PIN e confirmação de pagamento, fazendo a revenda receber erros evitáveis depois da tentativa.

**Nova experiência:**
- Cartão ARRIVING mostra claramente **Conferir entrega**.
- Marcação consciente de **Pagamento recebido** e campo **PIN informado pelo cliente**, numérico de 4 dígitos.
- Mensagem curta informa exatamente o que falta preencher. Copiar um PIN com espaços ou traços é normalizado localmente, sem armazená-lo ou transmiti-lo.
- O botão **Confirmar entrega** permanece indisponível até que haja 4 dígitos e recebimento declarado; fica igualmente indisponível durante uma ação pendente.
- Ao tentar chamar o fluxo diretamente sem campos válidos, o navegador foca o elemento que falta e não dispara o endpoint.
- O PIN **não é validado no navegador**: a função `merchantCompleteDeliveryLive` e o servidor continuam verificando a versão do pedido, PIN, recebimento e idempotência. Nenhuma mensagem de sucesso aparece se o backend devolver erro.

A confirmação continua sendo explícita. Nenhuma alteração de dados de banco, taxa, recebimento, PSP, liquidação, segurança ou permissões.

**Testes:** novo `tests/merchant-guided-completion-v1-275.mjs`, regressões de cartões e pedido, auditoria, build e E2E celular.
