# TAMÃO V1.295 — Chrome exibe “possível spam” no aviso de teste

## Situação confirmada
O usuário informou que a notificação foi apresentada pelo Chrome, mas apareceu acompanhada de um alerta de **possível spam**. Essa é uma classificação do próprio Chrome, não uma resposta do gateway nem uma prova de que o site enviou spam.

Chrome Android implementa detecção local de notificações indesejadas e oferece ao destinatário **Mostrar notificação → Sempre mostrar → Marcar como seguro**, quando reconhece o remetente. Referências oficiais: https://support.google.com/chrome/answer/3220216?co=GENIE.Platform%3DAndroid e https://blog.google/chromium/fighting-unwanted-notifications-wi/.

**Não existe API do Web Push para marcar automaticamente uma origem como segura no Chrome.** O TAMÃO não deve prometer remover o aviso, burlar a proteção ou pedir para desativar a segurança global do navegador.

## V1.295
- O painel do aparelho apresenta instruções claras para o Chrome e diferencia **apareceu com aviso de possível spam** de **não apareceu** e **apareceu normalmente**.
- Um relato anterior de que não apareceu pode ser corrigido para `spam_warning` apenas pelo mesmo usuário, inscrição push e revenda, dentro das 24 horas permitidas e em gesto expresso.
- A correção é um novo registro imutável em `merchant_push_report_corrections`, mantendo o relato original em `merchant_push_test_runs`.
- As consultas de último teste, sete dias por dispositivo e central administrativa usam o **relato efetivo** e contam `reportedWarning` separadamente.
- O Service Worker evita `renotify` em testes sucessivos e destaca no texto que o aviso foi solicitado voluntariamente.
- Não habilita cron, push automático de pedidos, campanhas ou movimentação financeira.

## Evidência
Aceite pelo provedor, exibição pelo Chrome e relato manual de possíveis avisos de spam são **eventos distintos**. Usuário pode marcar site como seguro no próprio Chrome; o aplicativo só registra seu relato. Todos os dados são vinculados à sessão e ao mesmo aparelho.

## Verificação
Aplicar migração, confirmar execução apenas por `service_role`, testar correção para usuário de outro aparelho (deve ser recusada), preservar a linha inicial e provar que o novo registro é somente append-only. A entrega fora do aplicativo precisa continuar sendo testada em aparelhos reais.
