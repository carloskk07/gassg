# TAMÃO V1.286 — base segura para notificações push

## Entrega desta etapa

- **Supabase:** tabelas privadas `merchant_push_subscriptions` e `merchant_push_outbox`, com RLS e sem acesso direto de clientes.
- **Eventos transacionais:** trigger registra intenções novas apenas para usuários operacionais autorizados e com inscrição ativa. Usa `event_key` único e `on conflict do nothing` para evitar duplicação. Não registra pedido antigo retrospectivamente.
- **Endpoint:** `merchant-push-registration` autentica JWT com Supabase Auth, verifica vínculo ativo e papel da equipe, aplica limite por usuário, valida endpoint/chaves e permite inscrever ou revogar dispositivo.
- **Service Worker:** trata `push` e `notificationclick` com mensagens genéricas, sem nome, telefone, endereço, PIN, preço ou detalhes do cliente.
- **Consentimento:** ativação de push é distinta da ativação de alerta local, exige ação expressa e permissão do navegador; ao sair da conta/trocar de revenda, tenta cancelar o push do aparelho.
- **Feature gate:** endpoint só fornece chave pública e habilita nova inscrição após `MERCHANT_VAPID_PUBLIC_KEY` válido e `MERCHANT_PUSH_SENDER_VERIFIED=true`. Em ausência dos dois, o botão push não aparece e alertas locais V1.285 permanecem funcionando.

## O que ainda NÃO está ativo

O remetente Web Push real, sua chave privada VAPID e a rotina de entrega/retentativa ainda **não foram configurados nem comprovados**. Nenhuma linha de outbox significa entrega; `provider_accepted` futuramente deverá significar resposta do gateway, **não visualização no aparelho**. Ainda não existe prova de envio com PWA fechado.

Não registrar credenciais privadas no GitHub, no navegador ou em RLS pública. Antes de habilitar `MERCHANT_PUSH_SENDER_VERIFIED`, será necessário implementar/remeter com Web Push assinado, revalidar consentimento e status atual do pedido, tratar 404/410 e expiração, monitorar tentativa/aceite do provedor, validar Android/Windows/iOS instalado com aparelho real. A fila foi concebida para não acumular eventos de usuários sem inscrição.

## Operação preservada

Sem alterações de preços, estoque, pedido, pagamento, comissões ou repasses. Não existem confirmações automáticas de pedido. Nenhuma funcionalidade de push substitui a sincronização do painel. Registro de intenções não garante notificação recebida.

## Gates

Testes `tests/merchant-push-foundation-v1-286.mjs`, auditoria de segurança, E2E móvel, build e prova da versão nos três domínios antes de anunciar publicação desta etapa.
