# ADR V1.158 — Habilitação progressiva por risco e modalidade de pagamento

**Status:** proposta de produto e arquitetura — **não implantada em produção**.
**Motivação:** reduzir o abandono de novas revendas sem autorizar cobranças antecipadas nem transações irregulares.

## Decisão central

Não usar uma variável booleana `merchant_ready` para todos os pagamentos. Separar:
- elegibilidade legal **por categoria/produto**;
- representação do CNPJ por usuário autenticado;
- prontidão logística e de catálogo;
- autorização **por modalidade de pagamento**;
- saúde financeira e restrições de risco;
- operação em cada município.

A revenda é apresentada ao cliente apenas quando está efetivamente habilitada para *pelo menos uma* modalidade de compra e produto, nunca apenas porque se cadastrou.

## Jornada progressiva

| Estágio interno | O que é pedido | O que permite |
| --- | --- | --- |
| INTEREST | Nome, contato com OTP, município e endereço inicial | Conta, catálogo preliminar, orientação; sem transações |
| DELIVERY_ONLY | CNPJ e representação verificadas, ANP válida para GLP (auto-consulta sempre que possível), endereço de origem, área de entrega, preço atual, estoque, horário, aceitação de pagamento na entrega | Ofertas e pedidos elegíveis, pagamento somente **na entrega** (dinheiro, maquininha própria, Pix próprio apresentado na entrega) |
| DIRECT_PREPAID | Concluir verificações adicionais conforme PSP, titularidade da conta da revenda, autenticação PSP real, webhooks, reconciliação, gestão de fraude e documentos pendentes | Pix/cartão antecipado **diretamente à revenda**, se PSP suportado e habilitado |
| ADVANCED | Melhorias e benefícios opcionais: automação operacional, promoções, volume baseado no histórico e capacidade demonstrada | Recursos adicionais, não uma condição para venda básica |

Estágio NÃO implica certificação/garantia pública pelo TAMÃO; a UI exibe apenas disponibilidade e meios de pagamento realmente autorizados.

### Exceções de segurança não negociáveis

1. **GLP não fica vendável sem autorização ANP vigente/confirmada** conforme Resolução ANP 958/2023. A consulta oficial por CNPJ/UF/município deve bater com o estabelecimento; divergência ou indisponibilidade sem registro válido bloqueia GLP, mas não necessariamente outros produtos permitidos.
2. Um CNPJ encontrado na ANP não autentica quem está tentando representá-lo. O convite e OTP de telefone/e-mail não bastam isoladamente: usar validação confiável de representação, com revisão humana só nos casos que a automação não comprove.
3. Água, lenha, carvão e outros itens aplicam seus **próprios** requisitos normativos; GLP desabilitado não bloqueia automaticamente catálogo não regulado.
4. Nenhuma forma de pagar antecipadamente aparece para DELIVERY_ONLY, nem pode ser forçada alterando requests, corpo do checkout ou eventos de pagamento.
5. O Pix/maquininha **na entrega** pertencem exclusivamente ao estabelecimento; TAMÃO não coleta, não retém e não repassa o valor dos produtos.
6. Pedido só é concluído após confirmação de entrega e de pagamento no fluxo existente; divergências e contestação permanecem tratáveis.
7. Permissões de emitir ofertas, concluir entregas, validar recibos e cobrar taxas da plataforma precisam ser aplicadas **no servidor**, sob autenticação e auditoria.

## UX de entrada rápida

1. Convidado ANP: CNPJ, razão social e endereço público já aparecem pré-preenchidos; convidado confirma dados e identidade.
2. Revenda não convidada: informa WhatsApp/e-mail, CNPJ e endereço (se GLP); dados oficiais são recuperados automaticamente.
3. Formulário comercial inicial: produtos vendáveis, preço, estoque, área/taxa de entrega, horário e meios de **pagamento na entrega**.
4. O motor calcula permissões; se legais e operacionais estiverem atendidas, abre a operação **DELIVERY_ONLY** para a cidade correta.
5. Painel mostra botão contextual `Habilitar Pix antecipado` com checklist próprio, sem barrar a operação presencial.

A UI cliente mostra `Pagamento na entrega` e as formas possíveis; não afirma `Pix online` até PSP direto habilitado. Não usar `pré-lançamento`, `piloto` ou `conta incompleta` como rótulos comerciais externos.

## Políticas do checkout

- `delivery_only`: modalidades `cash_on_delivery`, `card_terminal_on_delivery`, `merchant_pix_on_delivery` permitidas **apenas no recebimento presencial**. Nada de boleto/QR antecipado ou cobrança pelo TAMÃO.
- `direct_prepaid`: só incluir `merchant_direct_pix_prepaid` e/ou `merchant_direct_card_prepaid` para provedor autorizado, conta da própria revenda, titularidade verificada, webhook validado e recurso efetivamente implementado.
- Pedido registra modalidade, quem recebeu, confirmação e prova mínima; travar modalidade pelo servidor na criação da cotação/pedido e validar novamente no pagamento/aceite.
- **Mudança de estágio não retroage** em pedidos abertos: respeitar método contratado e tratar perda de elegibilidade com regras de cancelamento/reembolso.

## Política financeira TAMÃO

- TAMÃO cobra **somente sua taxa da plataforma**, não processa receita de produto da revenda.
- Para DELIVERY_ONLY, taxas podem ser contabilizadas e cobradas posteriormente por fechamento diário: exigir livro-razão idempotente por entrega concluída, fatura por revenda e monitor de atraso.
- Atraso relevante em obrigações TAMÃO pode suspender novos pedidos com critério configurável do Admin e tratamento de contestação; **não** bloquear ordens já aceitas.
- Não exigir antecipação de saldo apenas para começar a vender, salvo decisão posterior respaldada por risco/faturamento e autorização financeira explícita.

## Autorização de município

`market_city_offer_scope` hoje exige `merchant.status='active'`, CNPJ/ANP atuais, formas/rotas de pagamento e operação online. Alterar apenas via nova política explícita:
- `authorized_to_sell(product, merchant, city)`;
- `allowed_payment_modes(merchant, city, product, amount)`;
- `city_has_sellable_offer` quando ao menos uma modalidade **válida** é ofertável.
- Sobretudo, disponibilidade municipal não é igual a permissão de receber Pix adiantado.

Manter isolamento geográfico no banco para cotações, pedidos e reatribuições e controle de pausa administrativa. Nunca abrir município simplesmente porque um convite foi criado.

## Observabilidade e proteção contra abuso

- Acompanhamento de taxa de cadastro concluído, 1ª venda, tempo até 1ª entrega, cancelamentos, reclamações, divergências e atraso da taxa TAMÃO.
- Monitoramento proporcional a evidências e capacidade; limites de volume configuráveis por risco, sem limites baixos arbitrários que prejudiquem revendas legítimas.
- Capacidade declarada, estoque atualizado, presença recente, contato rastreável e possibilidade de interromper novas ofertas.
- Trilha administrativa registra **por que** uma permissão foi concedida ou retirada, fonte da ANP e data da última verificação.

## Plano de implantação e testes

1. **Fase contrato:** introduzir tipos de capacidades e estados; preservar compatibilidade do backend atual. Ensaiar produto GLP/não GLP e meios de pagamento.
2. **Fase COD:** backend aplica `delivery_only` de ponta a ponta (incluindo bypass de payload malicioso); UI exibe meios na entrega. Verificação de identidade e ANP sem exigir upload se fonte confiável já valida.
3. **Fase financeira:** usar reconciliação idempotente de taxa TAMÃO após entrega, limites/atrasos seguros e auditoria.
4. **Fase pré-pagamento:** integração PSP da revenda, titularidade, webhook, idempotência, contestação e liberação só para método suportado.
5. **Homologação real:** revenda autorizada, pedido real de baixo valor, pagamento na entrega, confirmação e cobrança TAMÃO separada. Sem simular aprovação legal como se fosse evidência real.

### Critérios de aceitação obrigatórios

- Revenda com identidade, GLP autorizado, catálogo e entrega aptos vende com pagamento na entrega **sem PSP antecipado**, sem habilitar outros meios.
- CNPJ sem autorização ANP não vende GLP, mesmo aceitando somente dinheiro.
- CNPJ verificado pela ANP sem comprovação de representante não pode ser sequestrado por cadastro oportunista.
- Pix antecipado forçado por frontend, API ou replay retorna erro de servidor e não cria cobrança.
- Revenda de outra cidade nunca recebe pedido por engano.
- Bloqueio de débito TAMÃO não altera recebimento passado nem pedidos já aceitos.
- Toda autorização é explicável no Admin e auditada; o parceiro vê poucas etapas e próxima ação clara.

**Nota:** este documento é uma decisão de arquitetura proposta. As funções já preparadas na branch V1.158 para diagnóstico assistido não devem ser integradas isoladamente antes do novo contrato de capacidade, para não reforçar exigências desnecessárias na primeira venda.

## Status da implementação delivery-first V1.158.1

Implementação protegida na branch de revisão (não é homologação nem deploy):
- payment_timing em pedidos e payment_timing_requested em cotações, com padrão seguro on_delivery;
- guarda SQL para pedidos na entrega com método ativo e rota presencial da revenda;
- guarda SQL contra checkout antecipado sem pedido prepaid, rota online e PSP ativo/homologado;
- ofertas e abertura municipal condicionadas a capacidade de pagamento na entrega;
- painel configura Pix na entrega sem credenciais de PSP; fundos seguem diretamente à revenda;
- catálogo multi-PSP preservado para integração opcional futura;
- testes de contrato, sem substituir E2E e prova SQL no ambiente real.

**Pendente antes de ativação:** executar migração controlada, provar que triggers convivem com RPCs e reatribuição, homologar revenda autorizada e representação, confirmar cobrança diária da taxa TAMÃO, provar isolamento GLP/não-GLP, testar Pix/maquininha reais e rollback. Esta fase entrega somente venda na entrega; prepaid segue bloqueado em novos pedidos até existir seleção explícita de cotação/pedido e verificação ponta a ponta.

## Revisão técnica — ensaio transacional V1.158.1 (11/10/2026)

- Migração aplicada apenas dentro de `BEGIN ... ROLLBACK` no PostgreSQL conectado: tabelas, constraints, funções e gatilhos foram compilados com sucesso; nenhum objeto da migração ficou persistido.
- Ensaio SQL com revenda transitória validou `flex_daily` sem compra de créditos e `sales_hold=false`, Pix no canal `delivery` com provedor Stone declarado, rejeição de `external` como entrega, rejeição de tentativa `online` por rota manual, recusa de método/rota desativados e concordância entre `market_filter_delivery_payment_merchants` e `merchant_delivery_payment_allowed`.
- Restrição anterior `merchant_payment_routes_declared_provider_metadata_check` bloqueava `delivery` para PSP declarado; foi ajustada para aceitar `external` legado e `delivery`, preservando `verification_mode=merchant_confirmed`, conexão nula e metadados de confirmação manual sem custódia.
- A seleção de ofertas e o gatilho SQL de pedidos usam a mesma autoridade por forma de pagamento. Terminal `device` só é elegível se o vínculo com o PSP estiver ativo e com capacidade verificada.
- Arquivo repetível de teste: `tests/sql/delivery-first-payment-v1-158-1.sql`; os objetos criados pelo ensaio são revertidos automaticamente.

### Limites ainda abertos (não autorizar produção)

1. **ANP por produto:** `merchant_anp_compliance_current` hoje considera qualquer GLP ativo no catálogo. Uma revenda com GLP ativo e autorização pendente pode permanecer bloqueada inclusive para água/lenha. Desacoplar exige gates por cesta em criação de cotação, novo pedido, aceite, reatribuição e resgate, preservando bloqueio de GLP em todos os caminhos. Não relaxar a função global isoladamente.
2. **Validação real da revenda:** nenhuma revenda de produção está cadastrada no Supabase inspecionado; não há comprovante de representação legal, autorização ANP nem entrega real para homologação.
3. **Fluxo financeiro:** a estrutura Flex Diário e a cobrança na liquidação existem, mas são necessários teste de entrega real, registro idempotente de receita TAMÃO, fechamento e contestação sob dados homologados.
4. **Checkout antecipado:** continua intencionalmente indisponível para novos pedidos nesta fase, mesmo com um PSP cadastrado. A segunda etapa exigirá seleção explícita de modalidade, titularidade da conta e validação do webhook.

**Política de merge:** manter PR em draft e nenhuma migração/deploy em produção até fechar os critérios acima.
