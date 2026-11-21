# TAMÃO Ads — abertura comercial V1.1105

## Modelo comercial inicial
- Publicidade por créditos pré-pagos, com PIX da própria conta verificada no Mercado Pago.
- Preço fixado no banco: **R$ 0,02 por visualização elegível**. Os valores de recarga (R$ 19,90, R$ 49,90, R$ 99,90 e R$ 199,90) são saldo, não planos de dias e não são garantia de visualizações.
- Anúncios entram em revisão do Admin; a publicação requer carteira positiva e configuração comercial aberta.
- Exibição apenas para visitantes com cidade/UF previamente conhecida no fluxo de cliente. A vitrine de seleção livre de cidade do anunciante é institucional e não pode debitar terceiros.
- Regras internas de elegibilidade: mais de 50% de visibilidade, janela contínua mínima no navegador, desafio de servidor com validade e limite, identidade derivada no servidor, exclusão do anunciante identificado, um desconto por token, um desconto por visitante derivado a cada 24 horas, limite de 200 por campanha a cada 24h e interrupção automática quando o saldo não cobre um novo débito. Não há certificação independente de audiência.
- A confirmação é contabilizada atomicamente em `ads_credit_view_receipts_v1_1098`, `ads_credit_ledger_v1_1097` e `ads_credit_wallets_v1_1097`; uma cobrança só acontece após o servidor revalidar o saldo e a campanha.
- A abertura comercial não publica campanhas fictícias e não movimenta saldo. A carteira de homologação de R$ 19,90 não é consumida por testes descartáveis.
- A opção de pausa no Admin interrompe **novas recargas e novos débitos**, sem alterar os saldos. Somente o superadministrador identificado e verificado pode acionar a mudança. Uma versão anterior não sobrescreve uma pausa recente.
- Transações confirmadas, históricos anteriores e direitos de reembolso aplicáveis permanecem respeitados.

## Comprovações obrigatórias antes da liberação
- [ ] Auditoria de Javascript e UI aprovadas; prévias de anunciantes sem débito
- [ ] PostgreSQL descartável: três exibições de R$ 0,02 e extrato; replay zero; primeira exibição prematura não cobrada; janela inválida não cobrada; mesma identidade 24h não cobrada; fora da região não cobrada; visita do proprietário não cobrada; saldo final zero; campanha pausada; ROLLBACK sem resíduos
- [ ] Builds dos três portais, revisão de UI e integração isolada aprovados
- [ ] Código da Edge Function `ads-credit` publicado, autenticado e idêntico à revisão da `main`
- [ ] Cloudflare Cliente/Parceiro/Admin com o SHA da mesma revisão publicada
- [ ] Banco de produção antes da abertura: sem campanhas ativas e com a recarga anterior preservada
- [ ] Ativação explícita do trio `recharge_enabled / view_debit_enabled / evidence_audited` e `version=version+1`, preço 2, `updated_by` do superadmin
- [ ] Após abertura, verificar que uma visita à prévia não gerou recibo nem débito, que a home sem região não serve uma campanha paga, e que o saldo e a fila financeira continuam consistentes

## Parada e reversão segura da abertura
No Admin, em Publicidade → Campanhas por visualização → Abertura comercial, marque a autorização e selecione **Pausar cobranças e recargas**. A ação faz uma escrita otimista do trio de bloqueios no Supabase, sem apagar campanhas, saldo ou histórico. A falta de permissão, falha de rede ou versão desatualizada não pode confirmar uma abertura. Em incidentes, o superadministrador também pode desligar os três controles mediante operação segura no banco.

## Limites honestos da homologação
Os testes validam regras de servidor em banco descartável e integração da UI, além de um pagamento real de R$ 19,90 já conciliado. Eles não substituem uma auditoria independente de tráfego, nem garantem procura ou audiência. Nenhuma visita, clique ou débito foi simulado em produção.
