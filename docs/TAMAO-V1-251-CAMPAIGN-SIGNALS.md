# TAMÃO V1.251 — Sinais de crescimento por campanha

## O que foi implementado
Na Central de financiamento e crescimento, a aba **Resultados** consulta as campanhas planejadas pelo fundador, gera um link exclusivo de divulgação por campanha e relaciona esse código aos indicadores agregados existentes.

A URL usa os parâmetros nativos da plataforma, por exemplo:
`https://tamao.com.br/?utm_source=tamao&utm_medium=owner_campaign&utm_campaign=tam-customer_cashback-202610-primeiros-clientes-01#home`

O identificador da campanha é formado por **benefício + competência + referência**, impedindo que referências de projetos diferentes recebam artificialmente os mesmos números. Nenhum tracking cookie novo foi introduzido; a coleta é agregada, de primeira parte, como já existente nas funções de eventos e nas submissões de leads.

## Dados consultados (sem criar dados fictícios)
- `platform_owner_budget_allocations_v1_247`: campanhas e orçamento distribuído, que é somente planejamento.
- `prelaunch_marketing_event_daily`: contadores de `landing_view` e `lead_form_view`, limitados a `utm_source=tamao`, `utm_medium=owner_campaign` e `utm_campaign` exato.
- `prelaunch_leads`: cadastros com essa mesma origem identificada e data dentro da janela da campanha, além das etapas de qualificação e conversão no CRM.
- A comparação considera o mês da campanha e, quando encerrada, a data do encerramento; como contadores de visitas são diários, a data final é aproximada para esses eventos.
- Eventos sem identificação de campanha são apresentados separadamente, nunca distribuídos artificialmente entre campanhas.
- Número de visualizações não é número de pessoas únicas. Conversão no CRM não é pedido entregue, receita nem lucro.
- O valor financeiro alocado não é gasto realizado. **ROI e receita atribuída continuam não mensurados**.

## Riscos que a versão evita
A tabela de pedidos e os créditos/recebimentos comerciais ainda não possuem um relacionamento verificável com o código UTM da campanha; consequentemente, seria incorreto dividir faturamento total proporcionalmente aos cliques. A V1.251 se limita a sinais reais de aquisição. A vinculação segura de pedidos dependerá de uma próxima evolução do rastreamento de consentimento/pedido.

A captura de acessos e formulários deixou de depender da flag de modo de prévia. Continua restrita aos domínios públicos oficiais, fora de testes, painel administrativo e portal de revendas. A função de captura existente mantém validação de origem, cotas e agregação sem identificadores persistentes de navegação.

## Proteção e publicação
A nova função SQL fica num esquema privado. Apenas a Edge Function `admin-ops`, com sessão autenticada e perfil `superadmin` ou `finance`, consegue consultar os indicadores. A RPC está sem permissão direta para o browser. O retorno não autoriza benefícios, caixa, saques ou pagamentos.

Testes: `node tests/owner-campaign-signals-v1-251.mjs` e suíte Audit. Aplicar a migração `20261014170000_owner_campaign_signals_v1_251.sql`; publicar `admin-ops` preservando as dependências e a configuração JWT atual; conferir versão e prontidão dos três portais após integração.

## Próximo passo
Criar ligação consentida e auditável entre campanha identificada e pedido pago/entregue, reconciliando a receita efetiva da plataforma e os custos, antes de apresentar qualquer retorno financeiro por campanha.
