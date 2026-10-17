# TAMÃO V1.383 — Acompanhamento após o aceite da revenda

Data: 17/10/2026

## Problema encontrado

A tela de acompanhamento apresentava informações corretas sobre os estados reais, mas usava o mesmo bloco visual e a mesma instrução genérica para momentos que exigem atitudes distintas: aceite da revenda, preparação, saída, chegada e recebimento. Em especial, o selo verde do cabeçalho podia aparentar uma atualização em tempo real mesmo quando o último registro consultado estava antigo ou a conexão não havia sido confirmada.

## Implementação

### Orientações conforme o estado oficial

- **MERCHANT_ACCEPTED:** o aceite existe, mas a preparação e a saída ainda não são garantidas.
- **PREPARING:** a preparação foi informada; não confundir com saída para entrega.
- **OUT_FOR_DELIVERY:** saída registrada; orientar a conferência de itens e preço antes de compartilhar código de recebimento.
- **ARRIVING:** chegada informada; evitar declarar recebimento antes da confirmação.
- **DELIVERED:** o recebimento consta registrado, mas a conciliação financeira ainda pode estar pendente.
- **SETTLED:** conclusão e conciliação registradas, com caminho para avaliação ou atendimento.

O novo cartão de acompanhamento é informativo e encaminha apenas para páginas internas já existentes: histórico, instruções de código quando disponível, e atendimento vinculado ao pedido.

### Comunicação de confiança

A apresentação do status utiliza a mesma prova de atualização já aplicada ao botão de ação principal, separando o estado consultado recentemente da consulta antiga ou com erro. Quando não existe leitura recente, aparece o aviso de atualização e um botão para consultar novamente. O usuário não recebe promessa de localização ao vivo, previsão fabricada ou entrega automática. Mesmo o cartão de recebimento não mostra o código PIN diretamente.

Pedidos ainda não aceitos, em reavaliação, aguardando nova proposta, sob risco ou cancelados não ganham um cartão que sugira entrega confirmada.

### Visual mobile

Composição editorial verde TAMÃO e âmbar para informação que precisa de atualização, mensagens de fácil leitura, áreas de toque acessíveis, botões adaptados a telas estreitas e respeito a movimento reduzido.

## Segurança e limites

Nenhum endpoint Supabase, ação de aceite, validação de código, pagamento, reembolso, comissão, autorização administrativa ou ativação comercial foi alterado. Os estados de pedido e horários vêm exclusivamente de leituras previamente confirmadas; o novo cartão não modifica o pedido nem expõe dados do entregador.

## Validação

- `node tests/customer-post-acceptance-v1-383.mjs` valida as seis etapas, ausência do cartão antes do aceite ou durante incidentes, status desatualizado, perda de conexão, integridade do PIN e acesso ao atendimento.
- As regressões V1.164, V1.179, V1.352 e V1.382 permanecem ativas no Audit.
- `Build isolated live portals` e testes de navegador mobile precisam passar antes do merge.
- É necessário comprovar separadamente a publicação Cloudflare e a reconciliação pelo SHA de `main`.

Esta versão melhora a clareza da jornada. Não se afirma redução de chamados ou ganho de satisfação sem dados de operação real.
