# TAMÃO Ads — Crédito pré-pago por visualização (V1.1097)

## Objetivo comercial

Substituir novas campanhas com tarifa por quantidade de dias por recarga de saldo publicitário, com consumo **somente por visualização elegível confirmada pelo servidor**. Não há mensalidade, fidelidade, cobrança acima do saldo nem custo por visita da home sem anúncio realmente apresentado. O modelo é para anúncios independentes (não altera o Clube, a Rede, produtos, cupons ou o saldo de outras taxas).

**Política de crédito:** saldo de publicidade para consumo interno, sem saque ou transferência normal; não há botão de resgate rotineiro. Restituições legalmente obrigatórias, erro de cobrança, pagamento contestado, exercício de direitos aplicáveis e falha de prestação continuam sujeitos ao fluxo apropriado, à análise documental e ao provedor. Não escrever "nunca reembolsável" como cláusula absoluta.

## Conversão — sem migração automática

As campanhas já contratadas em pacote por prazo fixo **seguem o contrato original**. Nenhum checkout V1.886, pagamento antigo, campanha ativa ou direito existente é convertido em crédito, estornado ou debitado por views. Se o novo modelo for liberado futuramente, a contratação comercial de novos pacotes fixos deverá ser encerrada com corte explícito e comunicação, sem interromper os anúncios antigos.

## Modelo financeiro

- Recargas admitidas no projeto: R$ 19,90, R$ 49,90, R$ 99,90 ou R$ 199,90, valores brutos em centavos.
- Parâmetro inicial de referência: **R$ 0,02 por visualização elegível** (não é oferta ativa; revisar com dados reais antes da liberação). Sem consumo mínimo e sem promessa de audiência. O crédito não vence em sete ou 30 dias.
- Saldo guardado em centavos inteiros e com ledger de evento único. Impossível gastar mais do que o saldo confirmado. Cada débito precisa ter prova distinta e não pode ser reaplicado.
- Recarga é obrigação de prestação de serviço até ser consumida. Não apresentar toda a recarga como receita realizada. Calcular contabilização fiscal/tributária com contador antes de ativar.
- Estorno ou contestação confirmados pelo Mercado Pago congelam a carteira, anulam o saldo disponível até o valor contestado e registram eventual déficit para revisão. Nunca apagar extrato, sobrescrever pagamento aprovado sem prova ou usar valores de outras carteiras silenciosamente.

## Controles instaláveis

Tabelas `ads_credit_controls_v1_1097`, `ads_credit_wallets_v1_1097`, `ads_credit_topups_v1_1097`, `ads_credit_ledger_v1_1097`, `ads_credit_verified_views_v1_1097`. RLS ativo; acesso apenas via funções do servidor autenticado.

Gates **desligados por padrão**:
- `recharge_enabled=false`
- `view_debit_enabled=false`
- `evidence_audited=false`

Recarga é bloqueada pelo banco até que **todos** estejam true. Endpoint `ads-credit` valida Origin, Auth permanente, quota, conta recebedora e PSP; webhook assinado faz GET do pagamento real. Acesso à cobrança anterior continua separado.

### Antes da liberação comercial

1. Implementar e provar **entrega das campanhas de crédito em espaço patrocinado real**, sem alterar a seleção/ranking orgânico e sem inferir a cidade do visitante.
2. Validar auditoria antifraude de views em produção (teste real da visualização na cidade, um segundo e 50% da peça, anti-replay, duplicatas, bots e limites por origem), nunca confundir diagnósticos de navegador com eventos faturáveis. Não elevar o gate só porque CI simulou uma prova.
3. Completar a integração de campanhas de crédito com cadastro, revisão, pausa, retomada e painel Admin. Impedir que novas campanhas do modelo antigo sejam vendidas quando o modelo novo estiver liberado.
4. Conferir pagamento Pix real em conta recebedora correta, PSP/webhook, conciliação automática, comportamento em repetição, Pix vencido, timeout, refund e chargeback. Os dados de CI são sintéticos, não comprovam dinheiro.
5. Revisar termos para anunciante, LGPD, CDC e regras civis aplicáveis, inclusive quando o anunciante for consumidor. Sem cláusula de perda arbitrária do saldo e sem retirada de canais de suporte legal.
6. Validar orçamento operacional da cidade e o preço de referência por view. Verificar que a campanha legada ainda entrega pelo prazo contratado.
7. Passar Audit, Deno Type, banco descartável, Chrome nas larguras 320/360/390/768/1280, Cloudflare SHA dos portais, migração verificada e reconciliação antes de habilitar qualquer função comercial.

## Fluxo para anunciantes

Após confirmação de nome, telefone e e-mail, a seção **Créditos de publicidade** deve mostrar saldo, consumos e extrato. Se os gates estiverem desligados, só apresenta situação informativa; não oferece Pix ou promessa de entrega. Quando habilitada com os testes financeiros completos: escolha recarga → aceite claro → Pix no site → prova do Mercado Pago → crédito idempotente → saldo disponível → campanha aprovada → visualizações elegíveis auditadas → débito atômico → pausa ao acabar.

## V1.1098 — campanhas integradas, ainda sem abertura financeira

A camada de campanhas está implementada com autenticação identificada e confirmada, envio idempotente, revisão administrativa, aprovação, publicação somente com saldo, pausa, retomada e encerramento. O espaço patrocinado possui desafio temporário emitido no servidor, conferência de tempo visível de no mínimo 1 segundo e 50% da peça, janela de deduplicação por origem pseudonimizada de 24 horas, limite piloto de 200 débitos por campanha/24h e débito transacional, sem saldo negativo. A campanha é pausada automaticamente quando o saldo não comporta outra visualização. O frontend preserva o rascunho ao mudar de recarga; a recarga Pix pendente pode ser recuperada ou conciliada sem emissão duplicada.

A antiga contratação por prazo segue em área separada e mantém seus direitos, histórico e fluxo de reembolso próprio. Nenhum pagamento da campanha de homologação do fundador é convertido automaticamente.

**Verificações técnicas:** GitHub Actions compila Cliente, Revenda e Admin separadamente, valida CSS/JS inicial, testa a página real no Chrome, executa o ledger e o ciclo de anúncios em PostgreSQL descartável com `ROLLBACK`. O teste isolado é necessário, mas NÃO substitui conferência de transações reais no Mercado Pago, aceitação jurídica/contábil e monitoramento antifraude.

**Estado comercial exigido antes da ativação:** manter `recharge_enabled=false`, `view_debit_enabled=false` e `evidence_audited=false` em produção. A interface deve informar que o pagamento está indisponível e não deve gerar Pix. É permitido instalar tabelas e servir páginas de cadastro/revisão sem iniciar cobrança, contanto que os serviços e bancos sejam publicados em ordem controlada e a produção seja verificada.

**Limitações explícitas:** a medição usa desafio controlado no servidor, hash de sinais de origem e declaração de visibilidade do navegador. Isso é uma filtragem técnica, NÃO auditoria externa independente ou garantia contra tráfego automatizado avançado. Não afirmar que impressões são certificadas. O preço inicial de R$ 0,02 por visualização é apenas referência técnica e precisa de aprovação comercial antes da venda. A política comercial deve preservar direitos legais de restituição onde se aplicarem.

**Critérios para fechar lançamento comercial:** teste real Pix → webhook assinado → saldo na mesma conta → aprovação do anúncio → visualização por visitante elegível → débito único → pausa por saldo → refund/chargeback e congelamento, com evidência registrada; revisão de fraude, LGPD, termos e contabilização; auditoria completa sem falhas e verificação dos três portais no SHA publicado.
