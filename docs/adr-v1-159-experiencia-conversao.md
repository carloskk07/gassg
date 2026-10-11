# TAMÃO — V1.159: experiência pública que convida e converte

## Propósito
A jornada pública não deve explicar primeiro como o software foi construído.
Ela deve fazer o visitante sentir, em poucos segundos, que encontrou um caminho
simples e confiável para resolver o que falta em casa — ou para vender mais com
a sua própria empresa.

**Promessa de marca:** Pediu? Tá na mão.
**Mensagem principal de home:** Faltou em casa? Tá na mão.
**Descritor:** Gás, água e o essencial do dia a dia, em um só lugar.

## O que mudou (código)
- Home: headline ligada ao problema do cotidiano, busca por CEP acima da dobra,
  promessa de clareza e roteiro de compra. Oferta visual rotulada como exemplo;
  nenhum selo de "mais procurado" sem comprovação.
- Disponibilidade: rota para verificar cobertura; sem ofertas reais, convite
  para consentir em um aviso por WhatsApp, sem criar pedido nem prometer prazo.
- Como funciona: começo pela autonomia da pessoa, explicações com passos claros
  e CTA direto de consulta. Segurança permanece explícita.
- Clube e indicações: benefícios explicados por elegibilidade, não por lucro,
  faturamento garantido nem comissão pela simples adesão de terceiros.
- Página de parceiros: crescimento potencial sem garantia de volume; pagamento
  direto à revenda, sem exclusividade; custo de taxa visível; simulador com
  custos reais e projeção claramente hipotética. Exemplo comercial neutro.
- Cadastro de parceiro: texto acolhedor, estado de cadastro retomável,
  aprovação documental e autorização ANP quando GLP.
- UI: hierarquia da ação principal, tipografia, micro-mensagens, hover e foco,
  telas pequenas, preferência por redução de animação.
- Compartilhamento: title/descrição social aderentes ao posicionamento.

## Linguagem por intenção
| Visitante | Pergunta que a página precisa responder | CTA |
|---|---|---|
| Consumidor | "Você atende minha região e quanto vou pagar?" | Consultar disponibilidade / Ver ofertas |
| Região sem oferta | "Posso ser avisado sem comprar agora?" | Me avise quando puder pedir |
| Revenda | "Vou controlar minha loja e quanto custa vender?" | Quero levar minha empresa ao TAMÃO |
| Visitante em dúvida | "O que acontece entre pedir e receber?" | Consultar minha região |
| Pessoa interessada em benefício | "Quais regras existem e quando pode haver crédito?" | Conhecer as indicações |

## Regras sem exceção
1. Nunca afirmar que há revenda, estoque, oferta, prazo ou pagamento antes de
   confirmação do backend para CEP/cesta/método.
2. Sem contagens de usuários, parceiros, avaliações, depoimentos, ranking,
   descontos, urgência, exclusividade ou garantia de renda inventados.
3. Nenhuma favorecimento nominal à revenda que forneceu a referência de preço.
   Preço local de referência do P13 não vira oferta comprável sem matching real.
4. Cidade personalizada não é autorização de comércio: respeitar gating da
   cidade e do catálogo, aceite e disponibilidade.
5. Não prometer entrega ou pagamento confirmado antes da prova operacional.
6. Cashbacks e comissões são condicionais à elegibilidade e políticas vigentes.
7. Cliente paga diretamente à revenda; cobrança da taxa TAMÃO segue separada.
8. Formulários pedem consentimento explícito; respeitar requisitos de LGPD.
9. Não usar "pré-lançamento", "piloto" como linguagem pública de marketing.

## Medição de resultado
A infraestrutura first-party atual já distingue origem/UTM e o funil de
captação; **não inferir melhora real de conversão só porque a interface mudou**.
Antes de atribuir ganho comercial, medir segmentos de visitante por cidade e
disponibilidade, depois comparar: visita -> interação de consulta -> CEP válido
-> oferta real exibida -> pedido confirmado (onde houver operação);
visita -> interesse por WhatsApp com consentimento; visita de parceiro ->
interesse -> cadastro real -> documentação válida -> primeira venda.
Se adicionar novos eventos, revisar minimização de dados, antiabuso e
privacidade antes de implementação.

## Próximas iterações condicionadas a uso real
- Teste de usabilidade moderado por celular com consumidores e gestores de
  revenda, medindo se cada pessoa encontra seu CTA em poucos segundos.
- Revisar o texto de objeções e abandono de formulário com resultados reais.
- Ajustar fotografia/ilustrações originais caso autorizadas; não usar imagens
  de revendas, entregadores ou clientes sem autorização e fonte.
- Experimentos de copy com atribuição e volume suficiente, sem claims falsos.
