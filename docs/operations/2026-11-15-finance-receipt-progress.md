# Progresso financeiro por cobrança original

Continuação de `main=6c6efa23908c62c019c4d62d1f1d23d305e4d129`, PR #1007.
A lista fixa permanece **14/19 frentes encerradas, #2, #3, #4, #6 e #12 abertas**.
Não reclassificar aceites comerciais por esta correção de acompanhamento.

## Lacuna corrigida

O painel de homologação usava contagens globais. Não vinculava o pagamento,
o crédito/campanha/cupons e o NET da mesma cobrança. A nova conciliação NET
já mostrava os líquidos no histórico, mas esse painel continuava sugerindo
etapas anteriores. Um crédito de outra operação podia também influenciar
a orientação mostrada ao proprietário.

O acompanhamento agora reutiliza a projeção NET e o leitor de contrapartidas
canônicas da recuperação Pix. Lê a cobrança original, verifica titular, valor,
evento e benefício; compara a auditoria imutável com a referência/order atual.
Somente a combinação da mesma cobrança pode concluir seu recebimento.

Cupons devolvidos exigem o protocolo da mesma fatura/titular e todos os
vouchers cancelados. O NET original é histórico, fora dos valores vigentes.
Uma falha de leitura, divergência ou mudança durante a consulta mantém a
cobrança em conferência, sem conclusão falsa ou incentivo a pagar novamente.

A janela de até 30 comprovantes é representativa. Caso haja recebimento fora
dela, a tela orienta consultar o histórico completo: não afirma que faltou
pagar. O estado de um módulo não descarta as provas conferidas de outro.
Não lê dados bancários de beneficiários nem altera privilégios protegidos.

## Comportamento no Admin

A mesma Central Financeira passa a mostrar as etapas da cobrança existente:
pagamento registrado, benefício conferido e líquido confirmado. O recebimento
pode estar concluído enquanto uso comercial, cancelamento e repasse continuam
com sua comprovação própria. A compra de cupons já devolvida aparece encerrada
com os vouchers cancelados; ela não volta ao fluxo de emissão/resgate.

Nenhuma nova cobrança, benefício, devolução ou transferência é criada.
Não foram criados fornecedor, consumidor, corrida ou comissão em produção.
A ativação de ofertas continua dependendo de fornecedor efetivamente apto,
preço, estoque e disponibilidade confirmados. O cadastro existente ainda tem
verificação documental pendente; autorização ANP não é presumida pelo CNPJ.

## Aceite verificável

- `finance-receipt-progress.mjs` executa o leitor real com contrapartidas,
  créditos não relacionados, auditorias divergentes, alteração de status,
  devolução e falha parcial, além da validação/renderização da UI.
- O teste SQL canônico da PR #1007 agora executa também esse leitor contra o
  PostgreSQL na mesma transação dos cenários Ads/mobilidade. A prova de NET
  nessa integração é sintética, com ROLLBACK integral.
- Executar Audit, integração, builds e revisão visual no HEAD exato; publicar
  o bundle Admin preservando suas dependências em produção, reler os arquivos
  e confirmar os três portais no mesmo SHA antes de declarar a entrega ativa.

Os resultados finais de publicação/provas ficam na PR e no topo da issue #493.
Nenhuma etapa comercial é declarada concluída por este arquivo existir.
