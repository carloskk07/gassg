# TAMÃO V1.320 — Prontidão comercial baseada em fatos

## Objetivo
Transformar a infraestrutura já implantada de publicidade V1.309–V1.319 em um roteiro claro de entrada no mercado, especialmente porque nenhum registro comercial real de Ads consta no banco no momento da implantação. O painel evita atribuir receita, pagamento ou entrega publicitária sem provas.

## Nova visão do Admin
**Ativações → O que falta para faturar com TAMÃO Ads?**

A consulta busca, diretamente no PostgreSQL de produção e exclusivamente para perfis administrativos, contagens atuais de:
1. Criativos aprovados e não publicados
2. Planos comerciais prontos para contato
3. Revendas que manifestaram interesse
4. Minutas de condições revisadas
5. Instrumentos com aceite bilateral registrado
6. Demonstrativos comerciais emitidos
7. Checkouts que constam como disponíveis
8. Aprovações vistas no último registro financeiro (não são necessariamente valores liquidados)

Destaca a primeira etapa ainda sem registros e exibe autorização pública, faturamento, verificação técnica de entrega, além do estado de **configuração local** da credencial Mercado Pago exclusiva da plataforma. A credencial, chave e identificação da conta jamais são exibidas na interface. A checagem da identidade real da conta somente acontece nos procedimentos financeiros autorizados existentes.

## Garantias
- RPC read-only `public.admin_ads_launch_readiness_v1_320` com proteção de papel administrativo independente do JWT do Edge. Execução apenas por `service_role`; não há grants diretos a anônimos ou usuários autenticados.
- A etapa de prontidão não cria contratos, checkouts, cobrança, receita, pagamentos, contas recebedoras ou campanhas.
- Não consulta o Mercado Pago por iniciativa própria. Não afirma que uma conta ou pagamento foi verificado só porque as variáveis de ambiente estão preenchidas.
- `verifiedRevenueCents=null` significa valor de receita liquidada **não comprovado por esta visão**, e não zero faturamento garantido.
- `publicAdsVerified=false` indica que esta consulta não comprova entrega publicitária; nem mesmo uma configuração de exibição habilitada constitui prova de alcance ou impressões.
- Os saldos de aprovação são estados históricos do livro PSP; aprovações sem consulta nas últimas 24h e reversões ficam explicitamente separadas.
- Sem nova regra de ativação global. Exigências regulatórias, fiscais e contratuais permanecem no processo próprio de conformidade e nas operações autorizadas.

## Artefatos
Migração `20261016140000_ads_launch_readiness_v1_320.sql`, rota `ads-launch-readiness` em `admin-ops`, painel `js/admin-activations.js`, estilos responsivos e regressões `tests/ads-launch-readiness-v1-320.mjs` e `tests/admin-activations-v1-307.mjs`.
