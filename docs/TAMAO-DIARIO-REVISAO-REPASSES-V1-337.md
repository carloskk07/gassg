# TAMÃO V1.337 — Diário imutável de revisão de repasses

Data: 16/10/2026. Portal: Admin → Aquisição/Financiamento → Central de revisão de repasses.

## Problema resolvido

As versões V1.334–V1.336 detectam divergências de comissões e permitem percorrer a competência inteira, mas uma investigação podia depender de anotações fora do TAMÃO. A V1.337 acrescenta um **registro administrativo independente do livro financeiro** para cada declaração de repasse existente.

## Dados e fluxo

Cada evento registra: declaração, código único de requisição, responsável, situação administrativa, justificativa e horário fornecido pelo banco. Estados permitidos:

- `in_review`: em análise.
- `awaiting_evidence`: aguardando evidências.
- `reviewed_no_bank_proof`: conferida sem comprovação bancária independente.
- `closed_administrative`: acompanhamento encerrado pelo administrador, **sem declarar pagamento comprovado**.

Não existe estado de `paid`, `settled` ou `bank_verified`. Nenhuma atualização de `orders`, `wallet_entries`, repasses, reversões ou créditos é efetuada.

O registro é **append-only**: toda mudança cria evento novo e uma trigger bloqueia UPDATE/DELETE. Uma chave `(claim_id, request_id)`, protegida por advisory lock, impede repetição da mesma solicitação. Reutilizar a chave com conteúdo diferente retorna conflito. O estado atual é calculado a partir do evento mais recente.

## Autoridade

Somente `superadmin` pode registrar análise. `finance` e `superadmin` podem ler. Controles aplicados tanto em `admin-ops` quanto nas funções RPC PostgreSQL. Sem privilégios públicos, `anon` ou `authenticated`; o gateway usa `service_role`. A tabela tem RLS habilitado e a função de trigger impede alterações retroativas.

A interface mostra a linha do tempo, identidade administrativa (ID), data, justificativa e situação. O botão de registro é exclusivo do administrador principal. Justificativa: 20 a 1000 caracteres. A interface valida retornos do backend e nunca apresenta estado bancário confirmado.

A leitura mostra os 100 eventos mais recentes da declaração, o total real e um aviso de truncamento quando existirem eventos anteriores. O sistema preserva a sequência completa no banco.

## Segurança operacional

Confirmações de status bancário, titularidade do beneficiário, execução de transferência e recuperação financeira permanecem **não comprovadas** pelos eventos do diário. São atividades separadas que dependem de evidências externas. `administrativeOnly=true`, `bankSettlementVerified=false`, `recipientVerified=false` e `moneyMoved=false` são marcadores explícitos dos RPCs.

## Evidência e teste

`tests/owner-payout-review-journal-v1-337.mjs` cobre imutabilidade, autorização no SQL e gateway, comportamento do portal com proprietário e financeiro, histórico e falha fechada diante de alegação falsa de liquidação. Integrado ao Audit.

A implantação exige migração rastreada, atualização `admin-ops` para a versão correspondente ao código GitHub, teste com consultas reais somente leitura, reconciliação Cloudflare e verificação de `PRELAUNCH`.

No ambiente verificado antes de implementar havia zero pedidos e zero declarações reais de repasse. Testes de escrita não criam pedidos falsos em produção.
