# TAMÃO — matriz de homologação das cinco frentes (15/11/2026)

> Documento de engenharia para **encerramento técnico**. Não é certificado de pagamento bancário nem de operação comercial. **Eventos comerciais futuros não bloqueiam o encerramento técnico nem a captação em PRELAUNCH**. Fonte: `LAUNCH.md`, `docs/TAMAO_EXECUCAO.md` e issue #493. Toda evidência sintética deve ser identificada.

## Inventário executável

A Auditoria do GitHub mantém `tests/homologation-five-fronts-gates.mjs`. O teste impede que os 21 vínculos obrigatórios entre cenários e workflows sejam perdidos sem falha de CI, incluindo três regressões transversais de formulário de revenda, segurança e primeira impressão. Os workflows preservados são:

- `Audit`: regressões do código e do comportamento da UI; cada PR.
- `TAMÃO isolated Supabase integration`: Auth, Edge Functions, PostgreSQL e Chrome descartáveis; cada PR e diariamente, sem credenciais de produção.

A proteção do vínculo é uma **verificação de instrumentação**: a aprovação real de cada cenário continua sendo o resultado independente do seu job.

| Frente | Provas técnicas contínuas | Eventos operacionais posteriores (não bloqueadores do encerramento técnico) |
|---|---|---|
| #2 Cupons | Botão de compra com aceite, duplo clique, Pix pendente e recuperação; emissão e compra em SQL descartável; uso, cancelamento, devolução e ressarcimento | Consumo em compra comercial legítima, liquidação financeira quando aplicável e conferência do benefício recebido |
| #3 Financeiro | Reconciliação e direitos financeiros das modalidades, publicidade, taxas de mobilidade, declaração e reversão de comissão | Confirmação independente dos PSPs e bancos em **eventos comerciais não comprovados**, incluindo repasses reais aos seus destinatários |
| #4 Pedidos | Login, cotação, aceite, estoque, entrega por PIN, simulação offline, interfaces Cliente/Parceiro/Admin, cancelamento e suporte | Pedido com mercadoria realmente entregue por revenda autorizada e pagamento na modalidade acordada |
| #6 Revendas | Cadastro e alterações sob revisão, CNPJ/ANP **fictícios no CI**, habilitação de oferta e bloqueio sem fornecedor, planos de cobrança | Documentação válida, representante autorizado, estoque/entrega/preço reais e modalidade de recebimento confirmada |
| #12 Rede | Link e cadastro, primeira compra qualificada, maturação, saldo, riscos, estorno, declaração e reversão de repasse **sintético** | Primeiro fato gerador comercial legítimo; identificação do beneficiário e comprovação bancária independente de qualquer saída de dinheiro |

## Fluxo novo: compra pelo botão do Clube

`tests/clube-coupon-purchase-click-journey.mjs` usa o módulo real `js/clube-coupon-shop.js` e executa a chamada do `onclick` produzida na página. A fronteira de pagamento é controlada, não há Pix bancário criado:

1. Abrir Clube e carregar pacotes: consulta, **sem cobrança**.
2. Clicar sem aceitar os termos: recusa e zero cobranças.
3. Aceitar e clicar duas vezes: somente uma requisição.
4. Tentar novamente com Pix original pendente: somente consulta da fatura original.
5. Resposta de rede perdida: a tentativa mantém a mesma chave idempotente.
6. Retomar um Pix preparado em sessão anterior: reutilização da chave persistida.
7. Pacote de revenda exige CEP confirmado e impede reutilização de Pix de outro CEP.
8. Trocar de conta durante a resposta: o Pix anterior não aparece para o novo titular.

**Limite de fidelidade:** este teste exercita o código de interface em ambiente Node/VM com respostas de Edge/PSP controladas, não uma compra com dinheiro real em Chrome. As provas complementares no banco e nas Edge Functions originais são executadas pela integração isolada. Não anunciar “Pix bancário aprovado” por causa deste teste.

## Critérios independentes de aceite

### A. Encerrar as cinco frentes de software

Para cada frente, o aceite exige **código existente e verificável**, cenários positivos, negativos, concorrência, repetição, papéis/RLS, recuperação, apresentação nos portais, CI verde e publicação correspondente. Exigências específicas:

- **#2 Cupons:** aquisição, reserva, aplicação elegível, limites, devolução, ressarcimento e estados de interface testados sem dinheiro real.
- **#3 Financeiro:** cobranças, retorno/webhook, conciliação NET, divergência, estorno, tarifas, obrigações, reversão e proteção contra dupla liquidação validados com PSP controlado e banco descartável. Integrações reais já verificadas não precisam ser repetidas.
- **#4 Pedidos:** jornada Cliente → Parceiro → Entregador → Admin, cotação, aceite, estoque, PIN, offline, recuperação, cancelamento e fechamento simulados fielmente e sem vazamento entre contas.
- **#6 Revendas:** inscrição, aprovação e restrições, catálogo, estoque, entrega, condição de pagamento, habilitação, suspensão e faturamento validados com empresa **fictícia apenas na CI**.
- **#12 Rede:** atribuição, convite, conversão, qualificação, carência, saldo, comissão, fraude, estorno e declaração/reversão financeira reproduzidos. **Se multinível, bônus de revenda ou saque automático fizerem parte do escopo aprovado, não chamá-los de implementados sem código e testes: finalizar ou registrá-los formalmente como expansão futura antes do aceite.**

Esses critérios **não exigem** revenda, cliente, compra, entrega, saldo ou saque reais. Lacunas técnicas comprovadas permanecem abertas. A partir da revisão dos testes integrados, **#2, #3, #4 e #6 têm aceite técnico para encerramento**; **#12 permanece aberta** por ausência de rede multinível, bonificação operacional de revendas indicadas e saque automático. **18/19 tecnicamente concluídas após a CI e a publicação da PR deste aceite.** Consulte o [dossiê das quatro frentes](2026-11-15-four-fronts-technical-closeout.md). A contagem anterior 14/19 é histórica; não a restabelecer por ausência de participantes reais.

### B. Liberar captação de clientes e parceiros

Independente das cinco frentes de vendas: confirmar site HTTPS, links e formulário reais, consentimento/privacidade, antiabuso, cadastros de cliente e revenda persistidos com deduplicação, leitura na fila Admin e tratamento de falhas. Validar em navegador/CI e produção por **leituras seguras** e prova de submissão somente quando autorizada; não criar leads fictícios em produção. É legítimo captar em `PRELAUNCH`, com comércio fechado e sem revenda ofertável.

### C. Habilitar pedidos e movimentação financeira

A operação individual continua subordinada a `platform_launch_readiness()`, documentação da revenda, oferta/estoque/capacidade/preço, recebimento correto, titularidade e verificações financeiras conforme aplicável. Só aceitar comprovantes verdadeiros para declarar uma **operação bancária efetuada**, sem convertê-la em pré-condição para buscar participantes. Um novo participante sem requisitos pode se cadastrar, mas não vender.

### D. Publicação e controle

Conferir SHA dos três portais, versão das Edge Functions afetadas, Audit, integração descartável, builds e readiness. Não afrouxar RLS, políticas de pagamentos, kill switches nem gates de transação para aprovar um checklist de captação.

## Continuidade sem recomeçar

Priorizar novos cenários que preencham lacunas reais e reaproveitar os testes atuais; evitar criar outro checkout, outro razão financeiro ou contas fictícias em produção. Registrar no topo da issue #493 links para PR, CI, evidências e a pendência específica. Em caso de falha da CI, reproduzir e corrigir mantendo as afirmações positivas de teste como obrigatórias.
