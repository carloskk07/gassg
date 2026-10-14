# TAMÃO V1.254 — conciliação por linha de extratos agrupados

## Regra contábil
Uma cobrança diária pode liquidar as taxas de vários pedidos da mesma revenda. A V1.253 permite atribuir ao marketing somente cobranças de um único pedido. A V1.254 cria um **razão contábil virtual de comprovação por pedido**, sem alterações financeiras: cada linha corresponde a um recebível original (`platform_receivables`), valor da taxa menos o crédito pré-pago aplicado.

Não há divisão proporcional. O valor de cada linha é exatamente `platform_fee_cents - prepaid_credit_applied_cents`, verificado contra o extrato diário completo, sua cobrança e o evento aplicado pelo provedor de pagamento.

## Conferências para um extrato entrar na soma
- Contém **pelo menos dois recebíveis**, mantendo resultados separados e sem duplicação da V1.253.
- O extrato está pago, resolvido por pagamento e com valor devido positivo.
- **Todas** as linhas de recebíveis pertencem à mesma revenda e a pedidos liquidados, com pagamento confirmado e estado financeiro não revertido. Um único erro exclui o extrato por inteiro.
- A soma de todas as linhas reproduz exatamente os totais de vendas, taxas, crédito pré-pago e valor devido registrados no extrato.
- Existe uma única cobrança aprovada para o extrato, de valor exato, aprovada por evento de provedor.
- O evento PSP está aplicado, é em BRL, ligado à mesma cobrança e revenda, com valor idêntico.
- Não há registro de estorno do pagamento PSP; nenhum dos pedidos do extrato tem ajuste de restituição de taxa ativo ou pago.

Após comprovação do extrato inteiro, a consulta só atribui linhas com **valor líquido positivo** a pedidos com UTM associado a uma campanha. Os demais pedidos continuam necessários para fechar a equação contábil, mas não são creditados à campanha. O resultado é derivado em tempo de leitura, reavaliando estornos e reversões; não se criam novos créditos ou ordens de pagamento.

## Operação
`Admin → Aquisição → Central de financiamento e crescimento → Resultados → Conciliação dos extratos com vários pedidos`.

Os números incluem taxas líquidas por pedido, pedidos comprovados e quantidade de extratos agrupados utilizados como evidência. A contagem de extratos pode aparecer em duas campanhas quando um mesmo extrato contém pedidos de campanhas diferentes; o valor de cada recebível pertence a uma única campanha e **não é duplicado**.

A prova é de **evento do PSP aplicado à cobrança**, não extrato bancário ou caixa disponível. Uma cobrança com crédito pré-pago comprova pelo PSP somente sua parcela líquida; o crédito pré-pago foi adquirido em transação anterior e não é somado novamente. Não se calcula ROI, custo real de campanhas, receita causal ou margens.

## Segurança
Função de ledger em esquema privado; wrapper SQL público executável somente por `service_role`; a Edge `admin-ops` exige `superadmin` ou `finance`, valida o contrato e não transporta informações de clientes ou IDs de pedidos ao navegador. Nenhuma tabela financeira é escrita.

Arquivos: `supabase/migrations/20261014200000_owner_campaign_batch_ledger_v1_254.sql`, `supabase/functions/admin-ops/index.ts`, `js/admin-acquisition.js`, `js/bootstrap.js`, `tests/owner-campaign-batch-ledger-v1-254.mjs`.

## Próximo passo
Um cálculo genuíno de ROI exigirá custos **efetivamente pagos** por campanha e eventual comprovação bancária de entrada. Até lá, as somas devem ser descritas como taxas líquidas atribuídas com base em **pagamento PSP**, sem causalidade presumida.
