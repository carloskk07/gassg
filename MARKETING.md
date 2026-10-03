# TAMÃO — Kit inicial de aquisição

## Objetivo

Captar dois públicos antes da abertura comercial:

1. **Clientes interessados** em gás, água e essenciais.
2. **Parceiros locais** interessados em vender pela plataforma.

O objetivo inicial é gerar demanda qualificada e rede de oferta — não maximizar volume de cliques.

## Mensagem central

**TAMÃO**
**Pediu? Tá na mão.**

Descritor:

**Gás, água e essenciais perto de você.**

## Campanha 1 — primeiros clientes

### Promessa segura

Entre na lista de abertura do TAMÃO em São Gabriel e seja avisado quando houver disponibilidade para sua região.

### Texto-base

**Acabou o gás? Precisa de água, carvão, lenha ou gelo?**
O TAMÃO está chegando a São Gabriel.
Entre na lista de abertura e seja avisado quando puder consultar preço e prazo perto de você.

CTA: **Quero ser avisado**

### URL

`https://tamao.com.br/?utm_source=meta&utm_medium=paid_social&utm_campaign=sg_launch_customer&utm_content=gas_01#home`

## Campanha 2 — parceiros fundadores

### Promessa segura

Transforme o TAMÃO em mais um canal de vendas para sua empresa, sem exclusividade.

### Texto-base

**Sua empresa vende gás, água, carvão, lenha, gelo ou outros essenciais?**
O TAMÃO está formando a primeira rede de parceiros de São Gabriel.
Cadastre seu interesse em menos de 1 minuto e converse com a equipe antes da abertura.

CTA: **Quero ser parceiro fundador**

### URL

`https://tamao.com.br/?utm_source=meta&utm_medium=paid_social&utm_campaign=sg_partner_founder&utm_content=partner_01#merchants`

## Orgânico / WhatsApp

Cliente:

`https://tamao.com.br/?utm_source=whatsapp&utm_medium=organic&utm_campaign=sg_launch_customer#home`

Parceiro:

`https://tamao.com.br/?utm_source=whatsapp&utm_medium=outreach&utm_campaign=sg_partner_founder#merchants`

QR/material físico:

`https://tamao.com.br/?utm_source=offline&utm_medium=qr&utm_campaign=sg_launch#home`

## Convenção UTM

- `utm_source`: meta, instagram, facebook, whatsapp, offline
- `utm_medium`: paid_social, organic, outreach, qr
- `utm_campaign`: sg_launch_customer, sg_partner_founder
- `utm_content`: criativo ou variação, ex. gas_01, gas_02, partner_01

Não mudar a nomenclatura no meio da campanha.

## Claims proibidos até haver evidência

Não anunciar:

- “menor preço garantido”;
- “entrega garantida”;
- “o mais barato de São Gabriel”;
- “ganhe dinheiro garantido”;
- “renda extra garantida”;
- “entrega em X minutos” sem prova operacional;
- quantidade de parceiros/clientes que não exista.

## Métrica inicial

Atribuição confiável disponível desde a primeira campanha:

- leads de cliente por source / medium / campaign;
- leads de parceiro por source / medium / campaign;
- CEP e categorias de interesse;
- reenvios por WhatsApp já deduplicados;
- taxa de contato;
- taxa de qualificação;
- taxa de conversão;
- tempo mediano até o primeiro contato;
- novos sem contato há mais de 24 horas.

### Como comparar campanhas

Não escolher vencedor somente por quantidade de formulários.

A sequência inicial de leitura deve ser:

1. **Volume** — quantos leads entraram.
2. **Contato** — quantos conseguimos realmente alcançar.
3. **Qualificação** — quantos confirmaram interesse/região/categoria.
4. **Conversão** — quantos avançaram para cliente/parceiro real.
5. **Velocidade de resposta** — quanto tempo levamos para fazer o primeiro contato.

Uma campanha com menos leads pode ser comercialmente melhor se entregar maior qualificação/conversão.

Os agregados são calculados server-side sobre a base completa; a lista visual recente do admin não é usada como denominador das taxas.

O TAMÃO agora mede **entradas de campanha e visualizações do formulário com analytics first-party agregado**, sem Meta Pixel ou Google Analytics. O admin consegue calcular entrada → formulário → lead → qualificação → conversão por source / medium / campaign / content.

Essa medição:
- funciona apenas no domínio oficial durante o pré-lançamento;
- não roda em localhost, GitHub Pages ou previews;
- não cria cookie publicitário nem identificador analítico persistente;
- usa sessionStorage somente para evitar contagem repetida na mesma aba;
- envia apenas UTM, rota sem query e domínio de referência;
- consolida os eventos em contadores diários;
- não grava IP bruto na tabela analítica.

Pixels publicitários de terceiros continuam fora desta fase. Qualquer adoção futura exigirá nova revisão de privacidade, consentimento e governança.
