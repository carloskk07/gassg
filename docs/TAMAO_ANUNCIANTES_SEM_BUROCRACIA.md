# TAMÃO — Anunciar rápido, vender quando quiser

**Decisão de produto — 19/10/2026:** o TAMÃO é uma plataforma de divulgação, comparação e conexão entre compradores e estabelecimentos, não o revendedor de gás/água/lenha/carvão/gelo. Cadastro de interessado em **anunciar** e habilitação do lojista para **receber pedidos pela plataforma** são jornadas diferentes.

## Primeiro contato: mínimo necessário

O convite para anunciar coleta **nome comercial**, **WhatsApp com DDD** e consentimento específico para contato. Nome da pessoa responsável, categorias de produtos, CEP e demais informações são opcionais e não bloqueiam o contato. Uma empresa não é obrigada a preencher CNPJ, ANP, endereço detalhado, comprovantes bancários, catálogo, estoque ou dados fiscais para **registrar interesse em publicidade**. O backend utiliza `capture-prelaunch-lead` com controle de origem, antirrobô, limite de requisições e chave de idempotência. Esta etapa **não** gera cobrança, anúncio público, ofertas elegíveis nem pedidos.

## Divulgar o anúncio — produto separado do checkout

Proposta operacional para a próxima entrega independente: cadastro mínimo `nome + WhatsApp + cidade/região + categoria/serviço + oferta/foto/preço (se quiser)`; confirmação do controle do contato e consentimento **específico para exibir nome e WhatsApp publicamente**, mais verificação simples de abuso e conteúdo. Não reaproveitar automaticamente o consentimento de contato do lead para publicar seu telefone.

Para itens comuns, não exigir comprovação societária antecipada apenas para publicar um classificado; se o anunciante quiser aceitar pagamentos/pedidos dentro do TAMÃO, aplicar os requisitos pertinentes **apenas então**. Anúncios são marcados como publicidade ou classificados, sem selo fictício de licenciamento, entrega, estoque, preço vigente ou aceitação de pedido. Diferenciar claramente `anunciante exibido` de `revenda elegível para receber pedidos`.

**GLP:** a atividade de revender gás continua sujeita à autorização da ANP (Resolução 958/2023). Para anúncios específicos de revenda de gás, buscar confirmação da autorização por consulta oficial ao cadastro ANP, de preferência automaticamente, antes de disponibilizar anúncio comercial que apresente a empresa como revendedor apto. Não impor ao usuário uploads repetidos de documentos quando uma consulta pública atual for suficiente. Informação de preço local histórica ou interna de teste pode ser mostrada como referência, nunca como oferta de revenda apta sem verificação.

## Pedidos intermediados e pagamentos: habilitação adicional por risco

Somente neste estágio solicitar os requisitos necessários ao fluxo concreto: identidade jurídica/representação adequadas, autorização da atividade quando regulada, preços/estoques/área de entrega atuais, aceite dos termos financeiros e configuração da conta que recebe. Preservar os gates de servidor, integridade de pedidos, reembolsos, PSP, comprovantes e operação da cidade; **não** flexibilizar `admin_set_merchant_status` por SQL nem adulterar verificações de CNPJ ou ANP.

## Admin e crescimento

O contato entra na central de leads existente, não em um segundo CRM. O Admin deve acompanhar duas conversões distintas: **interesse em anunciar** e **habilitação de pedidos**. Mostrar claramente pendências específicas sem forçar uma lista de documentos no primeiro contato. Não mover leads automaticamente para `merchants.status='active'`. Qualquer novo classificado público requer trilha de consentimento, moderação e ação explícita de publicação; o recurso ainda não foi implementado/implantado nesta etapa.

## Implementação desta rodada

- `js/acquisition.js`: primeiro formulário mostra só nome do comércio, WhatsApp e consentimento; nome pessoal/categorias/CEP ficam em painéis opcionais; nova copy com chamada para **anunciar**, sem sugerir publicação automática.
- `supabase/functions/capture-prelaunch-lead/index.ts`: aceita ausência de nome pessoal e de categorias **somente para leads merchant**; preserva validações de `businessName`, WhatsApp, consentimento, quota, prevenção de spam e idempotência; a captura de demanda de compradores segue exigindo interesses.
- `js/customer.js`: vantagem para o comerciante distingue anúncios de recursos de pedidos.
- `js/merchant.js`: registro completo oferece entrada alternativa de anúncio simples em `https://tamao.com.br/#merchants`.
- `tests/merchant-advertiser-light-signup.mjs` e teste V1.379: regressões de entrada simples, payload vazio opcional, consentimento, acesso à jornada comercial e mobile. Adicionados ao Audit existente.
- Tudo ainda **somente na PR #492 draft**. Nenhuma alteração ao status da conta de testes Carlos Santos, abertura comercial ou publicação automática.

**Próximo passo obrigatório para publicidade publicável:** jornada de anúncio diretamente editável e publicável após consentimento e moderação mínima, independente da estrutura transacional de `merchant_applications`, com status próprios e proteção anti-spam. Este passo não pode ser falsamente confundido com a atual captação simplificada de contatos.
