# TAMÃO V1.289 — VAPID seguro e inscrições-piloto de aparelhos

## Resultado técnico confirmado
- Um par ECDSA P-256 para VAPID foi **gerado dentro de uma função Edge protegida**, com `crypto.subtle.generateKey`. A função enviou a parte privada somente para uma RPC `service_role` que a armazenou no Supabase Vault. O servidor retornou HTTP 200, exibindo unicamente a chave pública.
- A base mantém **uma única chave por operação**, com bloqueio transacional contra rotação acidental. Assinaturas de Web Push existentes dependem da mesma chave.
- A configuração do banco publica exclusivamente `publicKey`, `available` e `testMode` por uma RPC não acessível a `anon` ou `authenticated`. A Edge de inscrição somente retorna a configuração depois de validar sessão, papel e quota.
- É possível preparar aparelhos voluntários para testes, sem declarar que recebam avisos. A interface indica claramente `Cadastrar aparelho para teste` e mantém os alertas locais já existentes.
- A opção de teste é conferida após a autenticação da revenda. Antes, o check inicial podia ocorrer cedo demais, sem sessão carregada, e o botão ficar oculto.
- O remetente passou a obter as credenciais privadas do Vault via RPC de serviço, **somente se** `merchant_push_keyring.sender_enabled=true`. Nenhum valor privado aparece no repositório, no frontend, no agendador ou na resposta de configuração.
- O Supabase Cron V1.288 continua com `enabled=false`; o envio remoto V1.289 continua bloqueado no remetente até teste real e habilitação explícita.

## Estado e evidências
- Chave pública criada, privada armazenada sob Vault.
- `merchant-push-vapid-setup` ativo para a instalação única, com token de bootstrap protegido e limites de corpo.
- `merchant-push-registration` aceita inscrição autorizada de teste, mas **não envia avisos**.
- `merchant-push-delivery` permanece com modo de envio bloqueado.
- Auditoria V1.289 e E2E móvel continuam exigidos antes da publicação da UI.

## Próxima prova operacional
Após integração e deploy, entrar no Portal das Revendas num dispositivo compatível, habilitar os alertas locais e clicar `Cadastrar aparelho para teste`. Confirmar a permissão do navegador. A base deverá registrar uma inscrição vinculada ao usuário e à revenda. **Não ativar o envio automático nessa etapa.**

Quando houver ao menos uma inscrição autorizada e aparelho disponível, poderemos fazer um disparo de teste controlado, confirmar a aceitação do provedor e a exibição em tela com o PWA fechado. Só então será justificável liberar `sender_enabled` e `merchant_push_cron_config.enabled`, considerando compatibilidade e riscos operacionais.

**Restrições preservadas:** sem movimentação de pagamentos, alteração de estoque, aceite, despacho ou conclusão automática de pedidos. Não há promessa de push com app fechado nem de entrega garantida.
