# TAMÃO V1.294 — Central administrativa de confiabilidade de notificações

No portal `admin.tamao.com.br`, área **Segurança e sistema**, a seção **Confiabilidade dos avisos push** exibe somente dados reais quando um administrador autorizado aciona **Atualizar indicadores**.

## Indicadores
Janela móvel: últimos sete dias; inscrições ativas são contadas no instante da consulta.
- aparelhos push inscritos e revendas com inscrições ativas
- testes executados, aceites do provedor e falhas
- relatos manuais "visto" e "não apareceu"
- aceites pelo provedor sem confirmação manual
- até 30 revendas com inscrições ou testes recentes
- leitura do estado atual do remetente e do agendador

O painel é **somente de leitura**: não envia testes, não altera o agendamento, não liga o remetente e não cria pedidos. Não são retornados endpoints push, tokens, chaves, IDs de usuários ou dados pessoais dos clientes.

## Segurança
A função Edge `admin-push-reliability` valida o token com Supabase Auth, rejeita usuário anônimo e verifica papel ativo em `platform_admins` (**superadmin**, **operations** ou **readonly**). A RPC `admin_merchant_push_reliability_v1_294` revalida o mesmo papel e é exclusiva ao `service_role`; invocações diretas do navegador não recebem permissão.

Os contadores não comprovam recebimento em aparelhos. "Aceito pelo provedor" ≠ "exibido no telefone"; "visto" é relato voluntário, não garantia de entrega futura. O campo `automaticDeliveryVerified` é explicitamente falso.

## Validação
- Testes de contrato para privilégios, métricas, interface e persistência dos controles desativados.
- Verificação SQL com perfil ausente ou não autorizado, e contadores existentes de produção.
- Build, auditoria e navegação móvel antes da integração ao código oficial.
- A ativação de avisos automáticos não faz parte desta versão.
