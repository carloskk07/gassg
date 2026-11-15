# TAMÃO — matriz de homologação das cinco frentes (15/11/2026)

> Documento de engenharia, **não** autorização de vendas ou certificado de pagamentos reais. Fonte de continuidade: `docs/TAMAO_EXECUCAO.md` e issue #493. Toda evidência sintética precisa aparecer explicitamente como sintética.

## Inventário executável

A Auditoria do GitHub mantém `tests/homologation-five-fronts-gates.mjs`. O teste impede que os 17 vínculos obrigatórios entre cenários e workflows sejam perdidos sem falha de CI. Os workflows preservados são:

- `Audit`: regressões do código e do comportamento da UI; cada PR.
- `TAMÃO isolated Supabase integration`: Auth, Edge Functions, PostgreSQL e Chrome descartáveis; cada PR e diariamente, sem credenciais de produção.

A proteção do vínculo é uma **verificação de instrumentação**: a aprovação real de cada cenário continua sendo o resultado independente do seu job.

| Frente | Provas técnicas contínuas | Evidência externa ainda necessária |
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

## Critério de liberação, por funcionalidade

1. **Cobertura funcional:** comportamento positivo e adversarial, replays, concorrência, papéis e renderização; CI aprovado no commit entregue.
2. **Prontidão operacional:** o próprio `platform_launch_readiness()` precisa confirmar fornecedor apto, oferta, owner, capacidade e pagamento, quando a modalidade depender deles.
3. **Prova externa:** comprovantes autênticos por transação/participante, sem reproduzir operações já conciliadas.
4. **Controle de risco:** estado da venda e configurações de segurança não devem ser alterados para passar um teste.
5. **Publicação:** confirmar SHA dos três portais e versão de Edge Function afetada; merge sozinho não comprova deploy.

Em 15/11, os aceites #2, #3, #4, #6 e #12 ainda **não estavam encerrados**; a referência histórica é 14 de 19 frentes técnicas. Modificar a contagem somente depois de documentar evidência suficiente para cada aceite.

## Continuidade sem recomeçar

Priorizar novos cenários que preencham lacunas reais e reaproveitar os testes atuais; evitar criar outro checkout, outro razão financeiro ou contas fictícias em produção. Registrar no topo da issue #493 links para PR, CI, evidências e a pendência específica. Em caso de falha da CI, reproduzir e corrigir mantendo as afirmações positivas de teste como obrigatórias.
