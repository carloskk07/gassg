# TAMÃO Negócios — plano de evolução comercial

**Visão:** TAMÃO é uma plataforma nacional de pedidos e, progressivamente,
de gestão e divulgação para revendas e outros negócios locais. O sistema de
pedidos é a porta de entrada; valor recorrente vem de ferramentas úteis
e publicidade com resultado verificável. **Nada aqui altera cobranças em produção.**

## Princípios que não podem ser negociados

1. Abrir conta, configurar catálogo e receber pedidos continua possível sem
   pagar assinatura Pro ou comprar anúncios.
2. Preço, prazo, cobertura e capacidade reais continuam definindo o ranqueamento
   **orgânico**. Divulgação paga aparece em área patrocinada separada e identificada;
   nunca altera elegibilidade de entrega, confiabilidade ou o resultado orgânico.
3. O TAMÃO cobra sua própria taxa/serviço. O dinheiro da venda dos produtos
   continua pertencendo à revenda e passa pelo PSP dela, sem repasses ocultos.
4. Crédito pré-pago é saldo destinado a taxas futuras, **não segunda receita
   adicional** sobre a mesma taxa. Cashback e comissão são custos/incentivos.
5. Qualquer oferta de serviço pago requer autorização explícita, preço e
   periodicidade claros, prestação efetiva e recibos conciliáveis.
6. Sem exposição ou venda de dados pessoais de clientes, sem usar dados de
   compras para marketing sem finalidade/consentimento adequados.
7. Abrir novas cidades continua automático conforme as regras operacionais de
   habilitação existentes, sem amarrar tudo à primeira cidade.

## Produto gratuito — núcleo de adesão (V1.231)

- Painel **TAMÃO Negócios** para proprietários e gerentes autenticados.
- Indicadores da própria revenda: pedidos criados nos últimos 30 dias,
  concluídos sem reversão, cancelados, revertidos, em andamento,
  valor registrado das vendas liquidadas e principais produtos.
- Tudo derivado do banco, isolado por merchant_id; nenhum número estimado
  ou gráfico com dados inventados; total de vendas **não significa lucro**.
- Links diretos para catálogo e Rede TAMÃO; divulgação orgânica por indicação.
- Consulta sob demanda para reduzir carga e evitar buscas automáticas inúteis.
- Sem assinatura, anúncio, pagamento adicional ou prioridade comercial ativados.

## TAMÃO Ads — receita por divulgação local (próxima fase)

**Público pagante:** revendas e marcas locais interessadas em maior visibilidade.

Primeiro entregar: intenção voluntária, autorização comercial,
segmentação por cidade/categoria, campanha com janela de exibição e
orçamento limitado, material revisado e rotulado como **Patrocinado**,
relatório de impressões verificadas/cliques/visitas qualificados,
prevenção de tráfego inválido, auditoria, contestação e cancelamento.
Sem nenhuma promessa de pedido ou posição orgânica.

**Política de lançamento:** não vender espaços em cidades sem audiência
mensurável; o benefício anunciado deve poder ser entregue. Cobrança só
após gestão de contratos, consentimentos, nota fiscal quando aplicável,
conciliação e faturamento separados das taxas sobre pedidos.

## TAMÃO Pro — assinatura opcional de gestão

**Possíveis recursos premium:** análises com períodos comparáveis, relatório
exportável, programação de estoque, gestão de carteira própria com permissão,
alertas de reposição e pedidos recorrentes, sugestões de mix de produtos,
rotina de equipe, automações informativas e integrações.

Pré-requisitos: ferramentas úteis no plano gratuito, custo real de operação
medido, teste voluntário de disposição a pagar, período claro e cancelamento
simples. Faixa de preço de **R$ 39–99/mês é hipótese de pesquisa, não oferta**.
Não retirar funcionalidades essenciais gratuitas existentes.

## TAMÃO Empresas — serviço B2B opcional

Condomínios e pessoas jurídicas poderão gerenciar solicitações em múltiplos
locais, autorizações de compra, limites, histórico e relatórios.
A receita adicional seria por serviço de organização, não por reter o
pagamento dos produtos. Fase posterior a disponibilidade real de revendas
e testes de faturamento e permissões por organização.

## Parcerias com fornecedores

Patrocínio ou promoção contratada, explicitamente identificada e auditável,
sem exclusividade forçada de catálogo, sem manipular concorrência na seleção
de vendedores e sem afirmações sobre comissões de PSP não contratadas.

## Ordem de implantação

| Etapa | Entrega | Critério verificável |
|---|---|---|
| 1. Núcleo | Indicadores comerciais privados e Rede TAMÃO integrada | ACL, testes negativos e métricas de pedidos reais |
| 2. Demanda | Pesquisa voluntária: anúncios, gestão Pro, compras corporativas | Interesse autêntico, consentido, por cidade e perfil |
| 3. TAMÃO Ads | Piloto restrito de publicidade claramente rotulada | Impressões auditáveis e audiência suficiente |
| 4. TAMÃO Pro | Plano opcional com funcionalidades mensuráveis | Valor comprovado, suporte e faturamento conciliado |
| 5. Empresas | Contas empresariais e recorrência B2B | Autorizações de compra, privacidade e cobrança própria |
| 6. Ecossistema | Patrocínios e integrações comerciais | Contratos, transparência, métricas e governança |

## Indicadores econômicos que devem entrar no Financeiro

Separar sem dupla contagem: GMV da revenda, taxa de plataforma gerada,
taxa **recebida e conciliada**, saldo de crédito antecipado ainda não consumido,
receita Ads reconhecida, receita Pro/Empresas reconhecida, estornos, incentivos,
custos de PSP, infraestrutura e suporte, contribuição por pedido/merchant/cidade.

Por cidade medir: revendas ativas, clientes com pedidos, pedidos concluídos,
frequência, aquisição, retenção, taxa de ativação, churn e volume de tráfego
verificável. **Nunca usar leads, visitas ou simulações como receita realizada.**

## Segurança e implantação

Toda leitura empresarial autoriza owner/manager no backend e novamente no SQL.
Funções de consulta usam SECURITY INVOKER com EXECUTE somente para service_role,
via Edge Function autenticada. Exibir apenas agregados da própria revenda, sem
telefones, endereços e valores de concorrentes. Mudanças futuras que concedam
destaque ou movimentem dinheiro exigem trilhas de auditoria próprias e rollout
gradual com proteção de regressão, antes de publicidade aberta ao público.
