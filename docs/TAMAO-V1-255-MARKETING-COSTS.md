# TAMÃO V1.255 — despesas de divulgação com referência documental

## Objetivo e escopo
O administrador principal pode registrar despesas **que declara já pagas** para divulgar uma campanha TAMÃO, com campanha, valor, data, meio de pagamento, referência única do comprovante e descrição. Os pagamentos de marketing são separados dos orçamentos para cashback, indicações e Clube TAMÃO: não consomem fundos reservados a benefícios.

## Evidência
O registro exige uma referência documental única de 12 a 120 caracteres, que identifica um documento ou transação existente fora do TAMÃO. O sistema **não recebe nem hospeda comprovantes em arquivo nesta versão**. O registro é uma **declaração do proprietário**, não reconciliação bancária independente. Não há upload de arquivo, API bancária, pagamento executado pelo site, saldo disponível ou ROI calculado.

## Operações
- Leitura: superadmin e finance. Consulta por competência; até 50 campanhas e 100 despesas mais recentes, com total completo por campanha e sinal de truncamento.
- Registro: apenas superadmin. Campos validados, valor de R$ 1 a R$ 50.000 por lançamento, competência da campanha e data compatível com período de alocação e, no máximo, 180 dias no passado; chave de requisição idempotente e comprovante único.
- Correção: apenas superadmin. Uma operação reversa registra evento e motivo sem excluir o lançamento original; valores corrigidos não integram o total ativo.
- O valor informado pelo proprietário é segregado de receita conciliada por PSP (V1.253–V1.254) e de gastos efetivamente verificados por banco.

## Segurança
Tabelas com RLS, sem grants de leitura ou escrita para clientes; esquema privado com ações privilegiadas protegidas; funções públicas invoker disponíveis apenas ao service_role. O backend exige a sessão administrativa e revalida os campos retornados. A interface isola dados por usuário e falha de maneira conservadora.

## Arquivos
- supabase/migrations/20261014210000_owner_campaign_marketing_costs_v1_255.sql
- supabase/functions/admin-ops/index.ts
- js/admin-acquisition.js e js/bootstrap.js
- tests/owner-campaign-marketing-costs-v1-255.mjs

## Evolução recomendada
Próximo passo: guardar comprovantes em armazenamento privado com hash, acesso autenticado e trilha de auditoria; depois conciliar extratos financeiros e custos de benefícios realmente pagos para calcular rentabilidade por campanha. Uma associação UTM não comprova causalidade de vendas.
