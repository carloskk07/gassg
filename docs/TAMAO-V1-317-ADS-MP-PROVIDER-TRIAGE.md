# TAMÃO V1.317 — Triagem de risco nos eventos Mercado Pago Ads

## Objetivo operacional

A caixa V1.316 guarda notificações assinadas e eventos de pagamento verificados pelo provedor. A V1.317 transforma essas observações históricas em uma **lista priorizada para o administrador**, agrupando notificações repetidas por revenda e ID do pagamento. O objetivo é acelerar a detecção e a verificação de estornos, contestações e aprovações pendentes de conciliação.

### Classificação de observações

- **Prioridade 1:** `possible_reversal`, quando o livro indica pagamento aprovado mas a observação mais recente aponta reembolso, contestação ou reembolso parcial; `post_reversal_activity`, quando o livro já está revertido mas chega nova observação de aprovação.
- **Prioridade 2:** `approval_to_verify`, quando existe uma observação de aprovação ainda não reconciliada no livro; `check_latest_provider_state`, quando a última observação não combina claramente com um pagamento já aprovado.
- **Informativo:** `aligned_observation` quando o registro é consistente com a última observação, e `informational` nos demais casos.

Não considerar esta classificação prova do **status atual** no Mercado Pago. A última notificação recebida pode estar antiga, ausente ou fora de ordem. A conferência financeira real só pode ocorrer pela operação V1.314, que consulta novamente o provedor e valida referência, valor, moeda, conta recebedora e autorização do administrador principal.

### Segurança e fronteiras

- Função SQL `admin_ads_mp_triage_v1_317` **exclusivamente de leitura**, acesso `service_role` com checagem dos perfis administrativos.
- Nenhuma tabela, cobrança, status, pagamento ou anúncio é alterado pela triagem.
- O painel **Admin → Ativações → Prioridades de conferência Mercado Pago Ads** destaca os possíveis estornos antes de mensagens informativas. Somente o administrador principal consegue acionar a conferência já existente.
- O relatório mostra o total de observações únicas e os itens que merecem conferência. Limita a visualização aos 50 itens mais importantes; não inventa alertas nem receita.
- O status `payment_approved` descreve a última conciliação realizada, **não** garantia de liquidação final ou ausência de chargeback.
- Com webhook desabilitado ou sem eventos, a fila fica vazia, mas isso **não comprova ausência de pagamentos**, estornos ou contestação.
- Não há alteração de credenciais e não foi feita transação ou chamada financeira real para criar testes.

## Arquivos
- `supabase/migrations/20261016110000_ads_mp_prioritized_triage_v1_317.sql`
- `supabase/functions/admin-ops/index.ts`
- `js/admin-activations.js`
- `tests/ads-mp-triage-v1-317.mjs`
