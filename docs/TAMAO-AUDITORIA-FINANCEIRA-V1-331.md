# TAMÃO V1.331 — auditoria da contabilização financeira e ressarcimento de cashback

Data: 16 de outubro de 2026. Referências: banco de produção Supabase e repositório oficial `carloskk07/gassg`.

## Constatação

A função `public.ensure_order_settlement_accounting(uuid)` cria o recebível TAMÃO e, se há cashback reservado, o registro de ressarcimento da revenda. Ambos os registros são únicos por `order_id` e usam `ON CONFLICT DO NOTHING` para reexecução idempotente.

A função já conferia que o recebível preexistente corresponde ao valor, à revenda, à taxa, ao crédito e ao vencimento do pedido. **O ressarcimento de cashback preexistente não era comparado ao pedido.** Se um registro com o mesmo `order_id` apresentasse valor, revenda ou vencimento divergente, uma reexecução terminaria `ok:true` e ocultaria a inconsistência. Um pedido sem cashback também poderia conviver com um ressarcimento incorreto.

A produção consultada contém 0 pedidos, 0 recebíveis, 0 ressarcimentos, 0 lançamentos de carteira, 0 concessões de recompensa e 0 reversões. Este é um defeito preventivo de integridade, **não uma ocorrência de desvio financeiro observada**.

## Correção

- Mantém a função e o modelo financeiro existentes, sem introduzir movimentação adicional.
- Depois do `ON CONFLICT`, exige igualdade exata entre `order_id`, `merchant_id`, `cashback_cents` e `due_at` do ressarcimento e os valores congelados do pedido.
- Para `cashback_reserved_cents=0`, exige inexistência de ressarcimento.
- Erro `SETTLEMENT_CASHBACK_REIMBURSEMENT_SNAPSHOT_CONFLICT` interrompe a contabilização e permite o tratamento existente de falhas financeiras diferidas. Não reconcilia automaticamente nem altera valores monetários.
- Um ressarcimento idêntico que já esteja legitimamente pago ou revertido não é recriado e pode passar pela conferência de identidade econômica.
- Preserva validação de recebível, bloqueios de status e requisitos de entrega/pagamento confirmados, versão de custos, lançamentos de crédito, regras de financiamento e autorizações.

## Cobertura e verificação

Teste: `node tests/financial-cashback-reimbursement-replay-v1-331.mjs`, incluído no workflow Audit. Casos de coincidência exata e reexecução paga; divergência de valor, revenda, pedido ou data; zero cashback com e sem registro; conservação da autoridade anterior.

Após integrar a migração, conferir `pg_get_functiondef`, o Advisor de Segurança/Performance, integridade dos valores existentes e os status dos três portais. Nenhum pedido real será criado para testar.

## Limites

Esta correção evita o **silêncio em uma reexecução divergente**, mas não constitui prova de conciliação bancária, pagamento do ressarcimento, entrada na conta da revenda ou liberação comercial. A auditoria financeira deverá continuar com liquidação, retorno de PSP, estornos e maturação de comissões por meio de evidências controladas.
