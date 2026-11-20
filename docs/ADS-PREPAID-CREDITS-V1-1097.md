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

**Status desta PR:** implementação inicial da carteira e Pix, **não é o lançamento comercial do novo modelo**. A parte de campanha por crédito e a medição faturável ainda são um bloqueio para produção. Não comunicar como "pronto para cobrar" até todos os portões acima serem fechados.
