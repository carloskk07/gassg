# TAMÃO V1.408 — Caminho verificável para vender pacotes de cupons

Status: **central administrativa de prontidão, somente leitura. Nenhuma venda ou resgate liberado.**  
Projeto: Clube TAMÃO, complementando as V1.239–V1.242.  
Data: 18/10/2026.

## Condição real apurada
Em produção, o Supabase contém **2 modelos financeiros ilustrativos**: gás (R$ 8,90; 3 descontos de R$ 5, mínimo de R$ 100, 180 dias) e água (R$ 4,90; 5 descontos de R$ 2, mínimo de R$ 30, 90 dias). Ambos têm `sales_enabled=false` e `redemption_enabled=false`, reforçados por CHECK; **não são ofertas**, e preços/regras podem mudar.

Na conferência inicial desta fase havia **0 intenções de revendas, 0 revisões comerciais e 0 minutas**. São dados momentâneos. O novo painel consulta as três filas vivas e mostra quantidades de propostas, interesses ativos e revisões; não confunde intenções com fundos, contratos ou estoque de cupons. As minutas exibidas são apenas o trecho de até 50 linhas retornado pela fila e não são total global.

## Jornada para chegar ao produto vendável

1. **Cidade e lojas participantes:** comércio autorizado pelo Admin principal. Cada revenda consente com a **aceitação de cupons** para a categoria, SKU, horários e limites de uso. A concordância em aceitar descontos é distinta de pagar por eles. Permitir que o TAMÃO banque 100% sem impor contribuição à revenda exige novo contrato e migração, não uma alteração informal no percentual proposto.
2. **Oferta congelada e política de validade:** versionar preço do pacote, valor unitário, quantidade, pedido mínimo, cidades/revendas atendidas, validade a partir de evento definido, limite por comprador, regras de cumulatividade e hipóteses de reembolso. O checkout deve exibir os termos aceitos e o contrato vigente, sem reinterpretar versões antigas.
3. **Verba real segregada:** consolidar contratos e origem do dinheiro (TAMÃO, marcas ou revendas), prova de recursos, limite por financiador e compromisso contábil. **Não contar o preço pago pelo cliente como substituto do dinheiro necessário para honrar os cupons.** Reserve cobertura para o **valor total de descontos vendidos**, incluindo os ainda não usados, além de tarifas, cancelamentos e contingências.
4. **Pagamento do pacote ao TAMÃO:** PSP regularizado com identidade recebedora, autenticação de webhooks, eventos conciliados e idempotentes, confirmação por cobrança liquidada e rejeição de replays. Manter o pagamento dos produtos **direto à revenda** e o da venda dos pacotes separado.
5. **Emissão atômica:** emitir N direitos individualizados **somente após confirmação financeira confiável**. Uma cobrança não pode emitir duas vezes, reembolso cancela saldo não utilizado, chargeback bloqueia emissão/uso novo. Uma reserva de verba deve ser serializada por campanha/cidade/fonte de recursos. Não emitir sem cobertura integral.
6. **Resgate dentro do pedido:** seleção e reserva transacional de um cupom elegível; **não** considerar aplicado antes de validar revenda, item, mínimo, região e cumulatividade. Em pedido recusado/cancelado, liberar reserva conforme política; em pedido liquidado, consumir exatamente uma vez e registrar obrigação de reembolso à revenda quando o TAMÃO/terceiros financiarem.
7. **Direitos do consumidor:** textos jurídicos e fiscais revisados, arrependimento/reembolso, política de pacote parcialmente utilizado, validade clara, suporte e extrato de cupons. Bloqueio de venda se a cobertura local deixar de suportar os direitos existentes.
8. **Testes e ativação:** cenários de concorrência simultânea, timeout entre PSP e webhook, duplicatas, preço alterado, cadastro desabilitado, cancelamento, uso expiração, estorno, devolução e esgotamento de verba. Piloto controlado, com liberação **explícita do Admin principal** e chave de suspensão imediata que não apague direitos adquiridos.

## Cenários financeiros conservadores (não são previsões)

- Modelo gás **financiado integralmente pelo TAMÃO**: o estudo V1.239 encontrou **–R$ 10,30 por pacote**, antes de outros custos, quando não há pedidos incrementais atribuíveis e se usam os parâmetros ilustrativos.
- Modelo água **financiado integralmente pela revenda**: –R$ 1,10 por pacote no cenário conservador com as hipóteses da simulação. Não significa que as lojas aceitariam financiar esse valor.
- Não contabilizar a taxa por pedidos que **já ocorreriam sem o cupom** como margem incremental automática. Não prometer lucro, economia líquida ou vendas garantidas.

## Escopo efetivamente entregue nesta V1.408

A aba administrativa **Aquisição** mostra a **Central de Prontidão dos Pacotes**, com consulta autenticada e sob demanda às ações já protegidas `clube-interest-queue`, `clube-campaign-queue` e `clube-terms-queue`. O painel:
- Rejeita dados que não comprovem origem, leitura apenas, venda desligada, zero contrato/verba e zero cobrança.
- Não apresenta totais parciais como contratos ou estoques nem retém dados de sessão anterior.
- Expõe gargalos de adesão, análise, documentos/financiamento, cobrança/resgate e decisão administrativa.
- Não concede benefícios, cria pagamentos, emite cupons, reserva fundos ou ativa cidade/campanha.

**Ainda não entregue:** PSP de pacotes, aceite jurídico, orçamento comprovado, direito emitido, motor de resgates, reembolso e interruptor real de vendas. A Central não substitui essas implementações.
