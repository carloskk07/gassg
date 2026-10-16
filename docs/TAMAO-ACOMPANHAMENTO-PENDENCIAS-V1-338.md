# TAMÃO V1.338 — Central de prazos e acompanhamento de revisões financeiras

Data: 16/10/2026.

## Objetivo

Evitar que declarações de comissão fiquem sem análise ou esperando evidências indefinidamente. A V1.338 reaproveita o **diário imutável V1.337** e expõe uma visão **somente leitura** dos casos da competência, com contadores de vencimento de prazo interno.

## Regras de prazo sugerido

Os prazos são recomendações para operação administrativa; **não** representam promessa de liquidação, prazo legal nem obrigação bancária.

| Estado administrativo | Referência temporal | Prazo interno sugerido |
|---|---|---|
| Não iniciado | Declaração reportada | 24 horas |
| Em análise | Último evento de análise | 48 horas |
| Aguardando evidências | Último evento de análise | 72 horas |
| Analisado sem comprovação bancária | Último evento de análise | 168 horas (7 dias) |
| Encerrado administrativamente | — | Fora da fila ativa |
| Declaração anulada | — | Fora da fila ativa; histórico preservado |

A fila destaca primeiro casos em que houve reversão de recompensa **após observação histórica positiva** do provedor; depois prazos vencidos; finalmente os acompanhamentos dentro do prazo. Em cada prioridade, ordem por vencimento e ID.

Os números exibidos contemplam **a competência inteira**, com até 30 registros mais relevantes no quadro de triagem. Havendo mais casos, a central existente V1.336 permanece disponível para percorrer todas as declarações.

## Segurança e rastreabilidade

- RPC SQL `admin_owner_payout_followup_read_v1_338`, `STABLE SECURITY DEFINER`, requer perfil ativo `superadmin` ou `finance`.
- `anon` e `authenticated` não possuem execução; `service_role` é o único papel técnico com EXECUTE.
- Integração `admin-ops` verifica autenticação e papel novamente e rejeita qualquer resposta que alegue movimentação de dinheiro ou comprovante bancário.
- Não cria cron, notificações, alertas externos, status de pagamento, lançamentos, transferência, estornos nem eventos no diário.
- A interface deixa explícitos os prazos internos e a diferença entre situação administrativa e comprovação financeira.

## Testes e publicação

`tests/payout-review-followup-deadlines-v1-338.mjs`: política de prazos, prioridade crítica, contagens, ocultação em outro mês e sem permissão, bloqueio de payload bancário contraditório, apresentação responsiva por cartões e campos exibidos. Teste incorporado ao workflow Audit.

Após merge aprovado: aplicar migração; publicar `admin-ops` com dependências iguais às fontes do GitHub; verificar a função com leitura real do banco, permissões, advisories, deploy Cloudflare, versões dos três portais e PRELAUNCH.

A produção estava com 0 pedidos e 0 declarações de comissão no início da implementação. A ausência de eventos não valida pagamentos bancários reais.
