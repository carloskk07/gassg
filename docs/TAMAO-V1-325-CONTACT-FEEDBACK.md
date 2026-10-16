# TAMÃO V1.325 — Avaliação do contato pela própria revenda

## Problema resolvido
A V1.324 registra relatos manuais de atendimento pelo administrador, mas não permite que a revenda registre sua experiência. A V1.325 acrescenta essa etapa como **declaração voluntária de quem solicitou ajuda**, sem afirmar entrega técnica de mensagem, ligação efetiva ou contrato.

## Experiência da revenda
No portal Revendas → Vender mais e ampliar sua rede → **Como foi nosso atendimento?**, o proprietário da revenda consulta apenas o último contato declarado no **ciclo atual** de solicitação de orientação. A tela mostra canal, resultado e data informados pela equipe, sem expor observações administrativas privadas.

O proprietário pode responder: **Fui atendido**, **Não recebi esse contato**, ou **Preciso de novo retorno**. O registro requer escolha explícita, checkbox de declaração pessoal, confirmação e autenticação como `owner`. O gerente pode consultar, mas não responder. Uma resposta por contato é registrada e imutável; contatos posteriores poderão ter sua própria resposta.

## Visão administrativa
Admin → Ativações → **Avaliações do contato pelas revendas** apresenta respostas atuais, falta de avaliação para contatos consentidos, e distingue claramente o relato da equipe da declaração da revenda. É um painel de leitura; nenhuma mensagem é enviada automaticamente, nenhuma tentativa é presumida.

## Segurança e limites
- Backend com autorização independente no Edge e no PostgreSQL. Somente `service_role` executa RPCs; nova tabela tem RLS e não dá permissões a `anon` ou `authenticated`.
- Registros apenas sobre o **último contato do ciclo ativo**: revenda ativa, interesse Ads atual, pedido `requested` ou `triaged`, versão vigente e vínculo do titular. Pedido retirado/encerrado bloqueia resposta.
- Registro com UUID idempotente, unicidade por contato, ator, horário do servidor e trilha auditável. Mudança de conteúdo com o mesmo UUID é rejeitada; uma segunda resposta para o mesmo contato é rejeitada.
- Não há disparo WhatsApp, e-mail, ligação, aceite comercial, cobrança, ativação de cidade, publicação de campanha ou reconhecimento de receita.
- A resposta da revenda é um **relato autenticado**, não prova técnica independente de envio/entrega. O formulário não divulga notas internas ao usuário.
- Nenhum contato fictício ou feedback sintético deve ser criado no banco de produção.

## Artefatos
Migração: `supabase/migrations/20261016190000_ads_contact_feedback_v1_325.sql`. Interfaces em `js/merchant.js` e `js/admin-activations.js`, APIs `merchant-ops` e `admin-ops`. Regressão `tests/ads-contact-feedback-v1-325.mjs`.
