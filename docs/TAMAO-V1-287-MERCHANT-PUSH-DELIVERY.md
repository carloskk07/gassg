# TAMÃO V1.287 — remetente Web Push com controle transacional

## Entregue

1. **Registro por dispositivo.** A tabela privada `merchant_push_deliveries` representa cada par `evento + inscrição` somente uma vez. Tem RLS e não concede privilégios ao navegador.
2. **Revalidação no envio.** O claim consulta inscrição ainda ativa, vínculo de membro, papel (owner/manager/operator ou driver), estado e destinatário atuais do pedido, vencimento da oferta e expiração do evento. Não envia uma oferta já aceita ou cancelada.
3. **Lease atômico.** A RPC server-only `merchant_push_claim_due` usa `FOR UPDATE SKIP LOCKED`, token aleatório por tentativa e prazo de lease para permitir recuperação após queda do executor. Worker usa lote máximo de quatro dispositivos e timeout de 8 segundos por push.
4. **Resultado auditável.** A RPC `merchant_push_resolve_delivery` exige token do lease, classifica aceitação do provedor, erro transitório, revogação ou expiração; limita tentativas, utiliza backoff e invalida inscrições 404/410.
5. **Criptografia padronizada.** Worker isolado usa pacote versionado `@mmmike/web-push@1.0.1` com RFC 8291 (aes128gcm), assinatura VAPID (RFC 8292) e TTL menor que a validade restante do evento. A mensagem só contém `new_offer` ou `assigned_delivery`, sem dados privados.
6. **Invocação assinada.** Apenas workflow GitHub Actions com OIDC RS256 validado por JWKS, repositório e IDs exatos, branch `main`, caminho de workflow e commit `main` vigente. Não há chave administrativa no GitHub; `verify_jwt=false` significa somente que o JWT OIDC é verificado dentro da função.

## Ativação bloqueada — proposital

O worker **já pode ser implantado isoladamente**, mas não realiza envios até `MERCHANT_PUSH_SENDER_VERIFIED=true` e configuração no cofre de Edge Secrets de `MERCHANT_VAPID_PUBLIC_KEY`, `MERCHANT_VAPID_PRIVATE_KEY` e `MERCHANT_VAPID_SUBJECT`. Nunca adicionar VAPID privado no código, GitHub Secrets, frontend ou migrations.

O workflow `merchant-push-delivery.yml` permanece **manual**, apropriado apenas para verificação de OIDC e smoke de configuração. GitHub Actions Cron tem granularidade mínima de cinco minutos e atrasos ocasionais; isso **não atende pedidos com oferta de curta duração**. A publicação da V1.287 não ativa processamento automático da fila. Antes de ligar a chave de readiness, é preciso instalar um acionador server-side com latência adequada (ex.: Supabase Cron + pg_net com autenticação privada), configurar um par VAPID persistente em Secrets e validar em ao menos Android e iOS instalado/Windows elegível.

## Limites honestos

`provider_accepted` confirma apenas que o gateway push aceitou a solicitação; não garante que o celular recebeu, mostrou ou que a pessoa leu. Retentativa após ACK perdido pode repetir mensagens; o Service Worker utiliza tag por categoria para reduzir duplicações visuais. Inscrições com consentimento revogado não devem receber novas tentativas. Uma conexão aberta via polling continua o fluxo primário.

Não foram geradas inscrições/recados simulados na produção. Não existe prova de push recebido em dispositivo real nesta etapa.

## Evidências

- Teste de política e estrutura `tests/merchant-push-delivery-v1-287.mjs`.
- SQL aplicado no Supabase e consulta de tabelas/RPCs sem eventos artificiais.
- Código Edge implantado deve ser comparado ao GitHub. CI e build aprovados antes do merge. Publicação dos três portais conferida por SHA.
