# TAMÃO V1.288 — agendador Supabase Cron com Vault

## Objetivo e resultado

A versão V1.287 criou o remetente assinado e o registro auditável por aparelho, mas dependia de um GitHub Actions manual: inadequado para ofertas que expiram em poucos minutos. A V1.288 acrescenta **Supabase Cron a cada 15 segundos**, `pg_net` e autenticação independente com bearer gerado e protegido pelo Vault.

## Segurança
- Chave de 256 bits gerada dentro do Postgres com `gen_random_bytes(32)`, armazenada criptografada em `vault.secrets`; banco armazena somente SHA-256 em tabela privada, sob RLS.
- Cron executa uma função PostgreSQL protegida, que obtém o bearer do Vault **somente quando a operação estiver ativada**. O comando de cron não contém segredo.
- O worker compara o SHA-256 recebido por canal HTTPS contra RPC de autorização liberada exclusivamente ao `service_role`. Rejeita bearer malformado, falha no banco, autenticação dupla e qualquer invocação sem permissão.
- Autenticação assinada GitHub OIDC da V1.287 continua válida no workflow manual, com a prova do SHA oficial. O novo caminho Cron não substitui a proteção OIDC.
- Nenhuma chave administrativa ou VAPID privada aparece no repositório, fluxo de automação ou UI pública.

## Estado real de publicação

O job `tamao-merchant-push-v1-288` está instalado com intervalo de `15 seconds`, mas **`merchant_push_cron_config.enabled=false`**. Portanto ele não executa chamadas `pg_net`, não reclama entregas, não envia notificações e não consome créditos de terceiros.

**A ativação não é automática.** Primeiro devem existir (1) par VAPID persistente e contato configurados em Supabase Edge Secrets; (2) prova de envio/aceitação HTTP no provedor com aparelho inscrito, com controle da assinatura e do consentimento; (3) verificação em aparelhos reais, inclusive compatibilidade PWA; (4) liberação explícita de `MERCHANT_PUSH_SENDER_VERIFIED`; e só então (5) autorização operacional para habilitar `enabled`. Essa ordem evita um lançamento fictício.

Supabase cron fornece intervalos de segundos na versão de Postgres do projeto, ao contrário do GitHub Actions Schedule que não serve para ofertas curtas.

## Monitoramento e critérios de aceite

- `cron.job_run_details` mostra execução periódica e permite identificar erros.
- `merchant_push_cron_config.last_enqueued_at` e `last_net_request_id` somente mudarão quando o envio programado for habilitado.
- `merchant_push_deliveries` distingue aceitação de provedor, perda de inscrição, expiração e retentativa. Aceite do gateway não significa notificação exibida no celular.
- A auditoria V1.288 cobre isolamento do segredo, controles fail-closed, ausência de bypass, 15 segundos e preservação de OIDC. O teste SQL comprovou `merchant_push_cron_tick() = false` enquanto bloqueado e recusou acesso de `authenticated`.

Sem alteração nos pagamentos, pedidos, estoque, comissões ou cobranças. O envio push remoto ainda não está ativo.
