# TAMÃO Ads V1.1100 — continuidade da proposta e recuperação da carteira

O estúdio público passa a preencher empresa, título, mensagem e valor no formulário
de créditos após **Continuar com esta proposta**. Campos já editados são preservados.
O destino e o consentimento continuam sendo decisões explícitas do anunciante.
O rascunho público é consumido para não reaparecer no formulário de outra conta.

Consultas e operações são vinculadas ao titular e à geração de autenticação.
Uma consulta antiga não substitui a leitura feita após o pagamento, e seu `finally`
não libera a operação da conta seguinte. `liveInvoke` oferece uma verificação opcional
da sessão imediatamente após obter o token e antes de enviar a requisição.

O prazo de 20 segundos cobre obtenção da sessão, rede e leitura do corpo. Em caso de
resposta perdida, a recarga mantém o mesmo identificador, inclusive ao recarregar a
aba. Apenas identificador, valor e data ficam na sessão local do titular; nenhum
Pix ou campo pessoal é persistido por essa recuperação. Valores não podem ser
trocados enquanto há uma intenção pendente. A consulta automática é somente de
leitura, a cada 30 segundos, enquanto a área estiver visível e houver pendências.
Um pagamento confirmado retira o QR e permite uma futura recarga independente.

O formulário usa validação nativa, envio por teclado, campos de pelo menos 16px,
contraste para o aceite e disposição responsiva. A interface descreve visualizações
como elegíveis; não afirma certificação externa.

## Verificação

- `tests/ads-credit-journey-v1-1100.mjs`: respostas fora de ordem, troca A/B,
  logout/login da mesma pessoa, preenchimento consentido usando os módulos reais,
  recarga com resposta perdida e retomada após reload, QR retirado após aprovação,
  polling sem emissão de pagamento, timeout completo e recusa de envio se a
  identidade mudar durante a obtenção do token.
- `tests/sponsors-premium-browser-v1-1090.mjs`: formulário autenticado em build
  descartável, com conta e leitura de carteira sintéticas, em 320/360/390/768/1280px;
  verifica continuidade da proposta, aceite desmarcado, contraste, fonte e overflow.
- Regressões anteriores do estúdio, cadastro identificado e isolamento dos portais.

As provas são de software. A V1.1100 não registra pagamento, estorno, visualização
faturada ou saldo sintético em produção. Nenhuma migração ou Edge Function é alterada.
O Pix legado de R$19,90 (`payment_approved`) permanece no contrato original.
As três flags de créditos continuam desligadas até a prova real da nova carteira;
a homologação do checkout anterior não comprova esse ledger novo.
