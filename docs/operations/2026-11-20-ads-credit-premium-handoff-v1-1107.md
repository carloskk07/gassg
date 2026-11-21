# TAMÃO Ads V1.1107 — orçamento preservado e apresentação premium

## Problemas corrigidos
- O estúdio público mostrava R$ 49,90 como orçamento padrão, mas exigia um clique adicional nesse valor para repassá-lo à carteira oficial. A ação explícita **Continuar com esta proposta** agora preserva exatamente o valor exibido, sem produzir Pix nem cobrança.
- O orçamento de cada opção exibe o limite matemático de visualizações faturáveis para o preço atual de R$ 0,02, incluindo a ressalva clara de que público e entrega não são garantidos.
- O resumo de etapas no formulário oficial estava fora de ordem: dava a entender que o anunciante precisava carregar créditos antes da revisão. Agora: enviar gratuitamente, aguardar análise, carregar após análise e acompanhar a divulgação.

## Limites e segurança
Nenhuma tabela do Supabase, função de cobrança, autorização, valor de crédito, configuração comercial, campanha histórica ou PSP é modificada. Os lançamentos reais permanecem intactos. A estimativa é aritmética, sem garantia de visualizações; somente o servidor valida elegibilidade e debita saldo.

## Validação
Os testes existentes `tests/sponsor-campaign-brief-v1-1096.mjs` e `tests/ads-credit-commercial-ui-v1-1105.mjs` receberam verificações regressivas para o orçamento padrão, a estimativa e a ordem da jornada. A aprovação final depende dos workflows de CI do PR e da publicação oficial.
