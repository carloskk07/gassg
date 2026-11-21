# TAMÃO V1.1104 — recuperação automática de recargas Ads no servidor

## Problema resolvido
A V1.1103 atualizava a carteira na página e recebia webhooks assinados, mas a fila privada de conciliação ainda não incluía as novas recargas de publicidade por visualização. Um usuário poderia pagar e fechar o navegador antes da notificação do Mercado Pago, deixando a cobrança pendente até outra visita.

## Abordagem
- Reutiliza o cron privado `tamao-payment-reconciliation` (a cada dois minutos), sem criar um segundo cron ou um novo mecanismo financeiro.
- Adiciona `ads_credit` às seis famílias da fila e cria um trigger no registro de recarga existente.
- Para cada topup, consulta o pagamento PIX original por ID; se a resposta de criação do Pix foi perdida, realiza uma única busca completa pela referência externa, com verificação de ambiguidade.
- Usa **exatamente** `recordAdsCreditPayment`, a rotina de prova criptográfica/provedor/valor/recebedor e RPC do webhook assinado e da conciliação do titular.
- Após a operação, faz leitura independente do registro financeiro e comprova **exatamente um** lançamento `topup` de valor correto na carteira correta. Apenas então sinaliza `verified`.
- Mantém estornos, revisões e cobranças ainda pendentes nos respectivos estados. Não faz estorno, não cria cobrança, não modifica taxas e não habilita comercialização pública.
- Não amplia permissões do banco: a fila e funções continuam exclusivas da conta técnica.

## Testes
- Regressão unitária para Pix com ID conhecido, pagamento perdido recuperado pela referência, dois resultados ambíguos, resultado inexistente, PSP aprovado sem crédito, banco aprovado sem lançamento, estorno confirmado e intenção reservada.
- Teste PostgreSQL descartável da sexta família, trigger, backfill, isolamento da fila, leases e resistência a respostas atrasadas.
- Auditoria geral, build dos portais, verificação visual e integração financeira isolada.
- A implantação exige a migração PostgreSQL e o redeploy da função Edge `payment-reconcile`; a alteração de código no GitHub **não** ativa a nova modalidade no cron de produção por si só.

## Precondições de publicação
1. Testes concluídos.
2. Deploy da Edge Function com os mesmos arquivos/dependências autenticados.
3. Aplicação da migração aditiva no banco.
4. Inspeção somente leitura da fila e do saldo real (R$ 19,90), garantindo ausência de créditos duplicados.
