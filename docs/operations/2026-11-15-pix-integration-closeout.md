# Frente #1 — aceite técnico da integração Pix/Mercado Pago

Este aceite conserva o denominador de 19 frentes. O fechamento técnico de
**#1 Pix e Mercado Pago** exige a integração, publicação e verificação desta
entrega; não basta o presente arquivo existir. Até os gates finais, a contagem
anterior permanece 13/19. Quando satisfeitos os critérios abaixo, passa a
**14/19 frentes técnicas encerradas e cinco abertas: #2, #3, #4, #6 e #12**.

## Critérios e provas

| Critério da integração | Prova |
|---|---|
| Pix dentro do TAMÃO e vínculo à cobrança original | Implementação da PR #998; QR/CRC/valor, cópia, titular e estados terminais nos testes existentes |
| Recuperação sem emitir outra cobrança | `payment-reconciliation-runner.mjs`: cinco famílias, ordem original, resposta perdida, referência, valor e busca paginada |
| Pagamento da plataforma e aplicação do crédito | Cobrança Essencial real de R$ 19,90, evento aplicado e saldo de 1990 centavos; `merchant-billing-entitlement.mjs` e integração de quatro planos |
| Recebimento real de cupons e líquido independente | Fatura original de 890 centavos; relatório `reserve-tamao-release-v1-2026-11-11-060525.csv`, transação `187772919707`, líquido de 881 centavos; registro automático em 14/11/2026 02h47 UTC |
| Estorno real, benefícios cancelados e repetição segura | PR #1000 e `2026-11-14-authorized-coupon-refund.md`: GET do provedor após um único POST autorizado; fatura/protocolo devolvidos, três vouchers `void`, zero usos; segunda execução sem novo POST |
| Recebimento real de publicidade | Campanha original de 1990 centavos, pagamento `188619956921`, eventos do provedor e publicação existente; sem nova contratação nesta entrega |
| Contrapartida obrigatória antes de concluir a conciliação | Novo leitor comum confere vouchers, prova e lote de mobilidade, alocação de taxas, evento/campanha Ads e verificação do pedido; recarga, fechamento e recuperação de dívida usam os registros originais |
| Casos negativos e infraestrutura real | `payment-entitlement-readback.mjs` cobre ausência, titular/valor/transação divergentes, duplicidade, revisão, estorno com benefício ainda utilizável e indisponibilidade; `isolated-payment-entitlement-readback.mjs` consulta o PostgreSQL completo dentro das transações canônicas existentes |
| Publicação e releitura final | Audit, integração, builds e portais no SHA da main; `payment-reconcile` ACTIVE com bundle relido; inspeção privada somente de leitura precisa confirmar os recibos existentes sem alterar dinheiro |

## Lacuna técnica concluída

O cron já usava os mesmos resolvedores dos webhooks, mas somente recargas de
revenda exigiam releitura do benefício. Nas outras famílias, uma linha marcada
como paga podia produzir `verified` mesmo sem voucher, lote, alocação ou prova
correspondente. Isso foi reproduzido no código real antes da correção.

Agora a rotina exige as contrapartidas existentes. Uma divergência vai para
revisão; falha de leitura continua sujeita à recuperação. Não há segundo motor
de crédito, emissão de cobrança, resgate, pagamento ou estorno. A devolução de
cupons também não pode encerrar a fila enquanto algum dos benefícios continuar
utilizável. Recuperações de dívida são conferidas pela equação SQL canônica,
incluindo pagamentos parciais e reaberturas, sem duplicar o cálculo financeiro.

## Limite do aceite

O ciclo Pix real aqui comprovado é o da compra original de cupons e seu estorno,
além dos recebimentos existentes de Essencial/publicidade. Os demais cenários
de pedido, mobilidade, consumo e reversão usam PSP/dinheiro sintéticos apenas
na infraestrutura descartável. Isso conclui a integração técnica; não afirma
que todas as modalidades tiveram dinheiro real movimentado, que o banco do
pagador foi inspecionado ou que houve repasse ao beneficiário.

Permanecem abertas as frentes de cupons em uso comercial (#2), Central
Financeira com todos os aceites comerciais (#3), operação comercial (#4),
revenda efetivamente ofertável (#6) e cashback/indicações/saques (#12).
O fechamento de #1 não muda os critérios dessas frentes, não habilita oferta
inexistente e não autoriza novos pagamentos. A situação final e os links dos
gates ficam na PR desta entrega e no ponto de continuidade da issue #493.
