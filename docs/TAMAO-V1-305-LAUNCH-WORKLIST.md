# TAMÃO V1.305 — Prontidão comprovada antes da primeira venda

## Objetivo
Uma **lista de tarefas real** para o admin, do cadastro do primeiro parceiro até a revenda efetivamente apta a receber pedidos. A estética, o build e a publicação das páginas não substituem comprovação de supply, owner, pagamento e entrega.

## Implementação
O painel principal e a área Sistema agora mostram quatro requisitos:
1. **Oferta real:** `supply.realSupplyConfigured` e revenda configurada
2. **Responsável:** pelo menos um owner operacional elegível `ownerReadyMerchantCount`
3. **Recebimentos:** forma de pagamento operacional confirmada `paymentReadyMerchantCount`
4. **Atendimento:** revenda ofertável agora `offerReadyMerchantCount` e `supply.availableNow`

Os critérios são calculados somente a partir do objeto autoritativo `platform_launch_readiness()`, exposto pela `summary` administrativa já autenticada. Sem informação, o indicador não é marcado como concluído. Cada item oferece um caminho para a ferramenta administrativa existente; nenhum botão cria pedido nem concede autorização.

Mesmo 4/4 não significa vendas liberadas: a verificação de publicação, os bloqueios de segurança, `readyToEnable`, `canActivateOperation` e a decisão do admin continuam separados. Sem promessa de renda garantida e sem métricas fabricadas.

## Estado medido no início da V1.305
Em 15/10/2026, `operationMode=PRELAUNCH`; os quatro requisitos comerciais estavam pendentes, apesar dos três portais comprovadamente publicados. Isto é uma fotografia do momento, não a declaração de estado permanente.

## Mudanças proibidas/que não ocorreram
Não altera `commerce_enabled`, `admin_paused`, `merchants.status`, flags de runtime, PSPs, push, cron, dinheiro, pedidos ou políticas comerciais. Não há migração de banco nem implantação de Edge nesta versão; a fonte de dados já existia. Preserva integralmente o botão protegido de ativação no admin, sem chamá-lo automaticamente.

## Testes
Testar estado desconhecido, 0/4, parcialmente pronto, 4/4 sem autoridade, portal desatualizado, bloqueio de segurança, condições completas com revisão administrativa e permissões de papel. Auditar todo o histórico, build dos portais e testes mobile de 320, 360 e 390 px.

## Validação de campo
Depois da primeira revenda estar de fato apta, validar em campo: oferta real por CEP, preço final, aceite, caminho do entregador, recebimento na revenda, comprovantes e suporte. Registrar tempos e falhas reais; não inventar uma operação de ponta a ponta. A decisão de abertura comercial pertence ao admin.
