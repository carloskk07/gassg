# TAMÃO V1.328 — Confirmação de retornos Ads pela revenda

A V1.327 liga um retorno agendado ao relato de uma nova tentativa da equipe. Esta versão acrescenta uma **consulta de encerramento do atendimento**, combinando esse relato com a resposta voluntária do titular registrada pela V1.325.

## O que muda
- Na área **Admin → Ativações → Confirmação dos retornos pela revenda**, a equipe acompanha tentativas posteriores ao agendamento e distingue: sem avaliação, confirmado pelo comerciante, contato negado pelo comerciante, comerciante solicitou novo retorno.
- Apenas tentativas que continuam sendo as **mais recentes do ciclo de solicitação atual**, com empresa ativa, canal compatível e interesse Ads vigente, aparecem na fila operacional.
- Relatos antigos/ciclos retirados são classificados como `outdated` e não voltam a ser apresentados como uma pendência atual.
- Avaliação negativa e ausência de avaliação por 48 horas são tratadas como situações para acompanhamento **humano**, não como mensagens ou chamadas automáticas.
- As métricas são contagens de declarações/feedback, não prova técnica de entrega. O banco retorna expressamente `independentDeliveryProof=false`, `messagesSent=0`, `adsLive=false` e `paymentCreated=false`.
- A consulta é somente para superadmin, operations e readonly. O proprietário continua utilizando a avaliação autenticada existente da V1.325 no portal da revenda. Notas internas não são enviadas a comerciantes.

## Segurança e operações
- Função PostgreSQL `admin_ads_return_feedback_closeout_v1_328`: `security definer`, `search_path` fixo, controle de administrador no banco; `EXECUTE` revogado de `anon` e `authenticated`, permitido apenas a `service_role`.
- Edge `admin-ops` valida ação, identidade, estrutura das linhas, consentimento atual e inexistência de envio automático.
- Não há nova tabela de escrita, mensagem, tentativa forjada, ativação comercial ou movimento financeiro.
- Para correção de eventos, usar os fluxos autenticados já existentes: contato declarado V1.324, feedback V1.325 e agendamento V1.326. Não inventar prova de contato.

Migração: `supabase/migrations/20261016220000_ads_return_feedback_closeout_v1_328.sql`. Teste: `tests/ads-return-closeout-v1-328.mjs`.
