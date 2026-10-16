# TAMÃO V1.326 — Retorno manual após avaliação negativa do atendimento Ads

## Necessidade
A V1.325 permite ao titular responder que **não recebeu contato** ou **precisa de novo retorno**, mas ainda não fornece à operação uma forma controlada de organizar uma nova tentativa. A V1.326 liga o feedback autenticado ao planejamento do retorno, sem confundir agendamento com contato efetivo.

## Administração
Em **Ativações → Retornos solicitados pelas revendas**, perfis administrativos consultam avaliações negativas do último contato declarado no ciclo atual, o consentimento vigente, planos e retornos vencidos. Somente o administrador principal pode agendar/reagendar data entre 1 e 30 dias futuros ou cancelar uma previsão ativa, exigindo nota interna factual entre 20 e 240 caracteres e confirmação explícita. O registro grava ator, versão do pedido, UUID idempotente, versão do plano, horário e auditoria. A nota interna permanece exclusiva da equipe.

## Revendas
Em **Vender mais e ampliar sua rede → Previsão de retorno da equipe TAMÃO**, owner ou manager consulta uma data agendada ou cancelada referente ao último feedback negativo do pedido atual. Nenhuma nota administrativa é exposta. O portal informa que a previsão não constitui prova de comunicação realizada.

## Segurança e correção
- Um retorno só pode ser planejado após declaração voluntária do titular como `contact_not_received` ou `followup_needed`, referente ao contato mais recente da solicitação ativa.
- A solicitação deve continuar `requested` ou `triaged`, a revenda `active`, o interesse Ads verdadeiro, o canal coincidente e a versão do pedido inalterada.
- Retirada do interesse ou mudança do ciclo invalida novas ações e oculta previsões antigas na visão da revenda.
- RLS ativo nas tabelas privadas; nenhum grant a `anon`/`authenticated`. Apenas `service_role` executa RPCs, com verificação independente de papéis no banco e Edge.
- O mesmo UUID não pode reaparecer com conteúdo diferente; versão otimista impede sobrescritas concorrentes.
- Corrigido erro de mapeamento da V1.325 em `merchant-ops`: a operação externa era `respond`, porém o booleano de consentimento encaminhado ao PostgreSQL comparava `submit`, resultando sempre em `false`. Agora o consentimento é encaminhado para a operação correta.
- **Nenhuma comunicação é disparada**, ligação é realizada, campanha publicada, contrato celebrado, cobrança criada ou receita reconhecida.

## Artefatos
Migração `supabase/migrations/20261016200000_ads_feedback_returns_v1_326.sql`, Edge `admin-ops` e `merchant-ops`, interfaces `js/admin-activations.js` e `js/merchant.js`, teste de regressão `tests/ads-feedback-returns-v1-326.mjs`.
