# TAMÃO V1.304 — Liberações administrativas com evidência real

## Situação verificada em produção
Em 15/10/2026, São Gabriel/RS estava cadastrada com commerce_enabled=false e admin_paused=false; uma revenda tinha status pending, uma solicitação empresarial constava como approved e havia um superadmin ativo. A publicação do site não significa operação comercial habilitada.

## Funcionalidades
- Edge Function admin-ops: ação read-only governance-gates. JWT verificado pela função, conta permanente, consulta a platform_admins active, permissão adicional de papel superadmin/operations/readonly; leitura fail-closed das tabelas market_cities, merchants e merchant_applications.
- Resposta sem dados pessoais ou segredos: estados de cidades, quantidades por estado das revendas e solicitações, flag booleana do pagamento direto e horário de verificação. Quantidade parcial identificada caso supere o limite de linhas. Não concede autorização.
- Dashboard admin, tanto na visão geral quanto em Sistema, com atualização e navegação para aprovações, habilitações, financeiro e expansão.
- Pausa administrativa de cidade: botão de pausar/retirar pausa apenas para operações e superadmin, usando a RPC já existente admin_set_market_city_pause através da Edge, com confirmação, justificativa e trilha da decisão. Retirar a pausa não altera commerce_enabled nem habilita a operação.
- Leitura limitada por identidade e papel da sessão, limpeza no logout e encoding de nomes no HTML. Ações usam índice de uma lista validada em vez de interpolar dados do banco nos manipuladores de clique.

## Regras preservadas
Nenhuma cidade, revenda, pagamento antecipado, anúncio ou Web Push foi ativado. O modo global já possui controles administrativos com requisitos de prontidão e verificação de portais. As autorizações server-side e auditorias continuam obrigatórias.

## Próximas lacunas
Concentrar políticas financeiras, benefícios, campanhas e patrocinadores, PSPs por revenda, categorias e notificações em gates administrativos efetivos; implementar no servidor qualquer autorização que ainda exista somente na interface. Não mascarar pendências sob rótulo de sistema pronto.
