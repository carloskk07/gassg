# TAMÃO V1.291 — Teste individual de notificações push

## O que foi construído
A revenda pode selecionar **Enviar notificação de teste** somente após cadastrar o aparelho e autorizar o navegador. A ação envia uma mensagem genérica **para a inscrição daquele usuário e daquela revenda**, sem criar pedido de venda.

O endpoint `merchant-push-self-test` valida o JWT na Supabase Auth, verifica vínculo ativo à revenda e só aceita um endpoint pré-inscrito do mesmo usuário. A RPC privada `merchant_push_test_reserve` faz uma reserva atômica, com limite de **uma tentativa por usuário a cada três minutos**, antes de obter as chaves de criptografia do aparelho. VAPID privado permanece no Vault e é acessado somente pelo serviço autorizado.

As tentativas ficam em `merchant_push_test_runs`, tabela com RLS e sem privilégios para usuários. Cada tentativa registra resultado do provedor, mas **não conclui que o aparelho recebeu ou exibiu** a notificação.

## Como validar em dispositivo real
1. Entrar em `https://parceiro.tamao.com.br` com a conta autorizada da revenda.
2. Ativar os alertas locais e cadastrar o aparelho para teste, autorizando notificações.
3. Na mesma seção, tocar **Enviar notificação de teste**. Conferir na tela o aceite ou falha informado pelo provedor.
4. Bloquear a tela/fechar o PWA e repetir depois do limite de três minutos, verificando pessoalmente a exibição. Registrar separadamente navegador, sistema, permissão, estado do PWA e recebimento observado.

Se a inscrição do aparelho não existir, o sistema responde sem enviar e informa que é necessário cadastrá-lo. **Testes reais dependem do aparelho; este código não constitui comprovação de entrega.**

## Cuidados preservados
O teste é um envio pontual solicitado pelo usuário. Não altera pedidos, pagamentos, estoque ou comissão; não aciona `merchant_push_claim_due` nem liga o Supabase Cron ou o `sender_enabled` das notificações automáticas. A resposta `providerAccepted` não significa que o usuário viu a notificação. O Service Worker não mostra dados de clientes na tela bloqueada.

## Verificações
- Testes automatizados V1.291 de controle de acesso, privacidade, layout e notificações.
- RLS e autorização de funções no banco.
- Build, auditoria e verificação dos três portais antes de publicação.
- Ainda sem aparelhos inscritos nem notificação real comprovada na data de implementação.
