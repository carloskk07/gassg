# TAMÃO V1.323 — Orientação comercial de publicidade solicitada pela revenda

## Problema resolvido
A V1.322 mostra apenas as revendas que marcaram interesse em publicidade; interesse não constitui autorização para marketing direto, nem prova de que alguém solicitou contato. A V1.323 separa os dois estados com um pedido voluntário e identificável de orientação comercial.

## Revenda
No painel **Vender mais e ampliar sua rede → Quer uma orientação para começar a anunciar?**, o titular de revenda ativa, com interesse Ads registrado, consulta o servidor, escolhe canal preferido (WhatsApp, telefone ou e-mail), descreve o assunto em 20–240 caracteres, marca consentimento específico para receber orientação comercial e confirma. Pode retirar o pedido a qualquer momento enquanto estiver aberto. A gerência apenas consulta o estado.

A confirmação é salva no banco com usuário autenticado, data, versão e chave UUID idempotente. Alterações de revenda ou conta invalidam leituras antigas. Nenhuma mensagem é enviada pela própria solicitação.

## Administrador
A Central de Ativações apresenta **Revendas que pediram orientação de publicidade**, com quantidade real de pedidos e abertos, motivo declarado, canal escolhido, status e indicação de consentimento atual (o interesse pode ter sido retirado posteriormente).

Somente o administrador principal pode mover um pedido novo para **Em triagem interna** ou encerrar a solicitação, sempre com justificativa e versão verificadas. Uma mudança de estado **não comprova que houve contato, resposta ou entrega de mensagem**. O painel permanece explícito: mensagens automáticas enviadas = 0. Os dados da solicitação não são publicados na home.

## Segurança
- RLS ativada nas duas novas tabelas; privilégios diretos de `anon` e `authenticated` revogados; somente `service_role` executa as RPCs.
- Perfis conferidos no Edge e no PostgreSQL. Titular `owner` é o único que registra ou retira pedidos; admin `superadmin` é o único que muda etapas internas; operações e leitura administrativa permitidas a perfis específicos.
- Pedido exige interesse Ads atual e revenda ativa. Uma retirada do interesse torna a autorização de contato **não atual** na fila administrativa; não pode ser marcada triagem enquanto o interesse estiver retirado.
- Versionamento otimista, replay idempotente de UUID e trilha `platform_admin_audit`. Nenhuma cobrança, checkout, campanha publicada ou cidade ativada é gerada.
- Consultas simples não criam mensagens; não se presume que o WhatsApp, telefone ou e-mail escolhido esteja tecnicamente confirmado ou disponível.

## Artefatos
`supabase/migrations/20261016170000_ads_merchant_assistance_v1_323.sql`, `supabase/functions/admin-ops/index.ts`, `supabase/functions/merchant-ops/index.ts`, `js/admin-activations.js`, `js/merchant.js`, `css/components.css`, `tests/ads-assistance-v1-323.mjs`.

**Limite:** o registro é uma fila interna de pedidos iniciados pela própria revenda, sem promessa de atendimento instantâneo, envio de mensagens ou contratação.
