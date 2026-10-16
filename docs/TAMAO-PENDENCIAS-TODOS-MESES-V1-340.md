# TAMÃO V1.340 — Pendências financeiras abertas de todos os meses

Data: 16/10/2026. Portal: Admin → Aquisição / Financiamento → Central de repasses.

## Problema identificado

A fila V1.338 atende uma competência (mês) por vez. Caso uma revisão de setembro permaneça aberta quando o administrador passa a trabalhar outubro, ela desaparece da visão habitual de acompanhamento, embora continue registrada no banco. Isso compromete o controle diário de casos antigos e vencidos.

## Implementação

A V1.340 acrescenta a visão **Pendências de todas as competências**, calculada diretamente das declarações de repasse, revisões imutáveis, anulações, concessões revertidas e observações externas.

O painel mostra contadores para todos os meses: casos ativos, casos de meses anteriores, prazos internos vencidos, estornos críticos com sucesso de PSP observado, casos sem análise, aguardando evidências e número de competências com pendências.

A lista exibe as 30 maiores prioridades: primeiro estorno com observação histórica positiva, depois revisões vencidas e demais casos; desempate por vencimento e ID. Cada cartão inclui competência, pedido, declaração, valor nominal reportado e prazo interno sugerido.

**Abrir competência para revisar** altera o filtro para o mês do cartão e usa a consulta V1.338, que por sua vez fornece acesso à revisão direta e ao diário imutável da V1.339. Nenhum lançamento é criado por esse atalho.

Os contadores abrangem todas as competências. A lista é limitada a 30 itens e o painel explica essa limitação, sem sugerir que casos fora da página foram resolvidos.

## Segurança

- `public.admin_owner_payout_global_followup_v1_340(uuid)`: leitura estável, `SECURITY DEFINER`, checagem de administrador ativo `superadmin` ou `finance`.
- `anon` e `authenticated` não possuem EXECUTE; apenas `service_role`.
- A rota `owner-payout-global-followup-read` da `admin-ops` valida novamente permissão, contagens, contrato de prioridade, IDs, datas e marcadores financeiros.
- Não existem ações de escrita, notificações, estornos, novos créditos, cobrança ou transferências.
- `readOnly=true`, `administrativeOnly=true`, `bankSettlementVerified=false`, `recipientVerified=false` e `moneyMoved=false` impedem confusão entre acompanhamento administrativo e prova de pagamento.
- Prazos são orientações internas de revisão, não prazos do banco/PSP nem obrigações financeiras.

## Testes

`tests/payout-global-followup-v1-340.mjs` cobre um cenário de setembro pendente em outubro, prioridade de estorno, autorização de perfis, navegação para o mês do caso, resposta inconsistente e não reconhecimento falso de recebimento bancário.

A migração e o deploy administrativo deverão ser acompanhados por verificação de função instalada, direitos de EXECUTE, leitura real em produção sem criar dados, controle PRELAUNCH e workflows de publicação Cloudflare.

## Limite da homologação

A base consultada anteriormente tinha zero pedidos, zero declarações de repasse e zero eventos. A lógica é auditável e testável com dados fictícios na suíte, mas a ausência de pagamentos reais impede afirmar que conciliação bancária de ponta a ponta foi exercitada.
