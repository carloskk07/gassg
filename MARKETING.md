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

## Rede TAMÃO — fundação V1.226

A experiência pública volta a destacar **Indique o TAMÃO**, inclusive nas
cidades em que ainda não há oferta habilitada. O visitante pode convidar
amigos ou apresentar revendas por link/WhatsApp. O código de uma conta
existente é preservado como pista de atribuição por até 30 dias no navegador;
o código NÃO é prova econômica e não autoriza premiações.

Na captura de leads consentidos, o servidor somente registra a primeira
atribuição de um lead recém-criado (não deduplicado, não reexecutado), após
validar o código do usuário ou da revenda no Supabase. Convites inválidos
não são atribuídos e não impedem o cadastro. O status retornado
`referralCaptured` só é verdadeiro quando a gravação foi confirmada.

Revendas autenticadas com papel proprietário ou gerente podem gerar um
código aleatório próprio e consultar contagens agregadas de interesse
de novos clientes e de outras revendas em **Minha rede**. Convites de
equipe permanecem separados. Os registros não incluem nomes, WhatsApp,
e-mails ou dados financeiros na resposta à revenda.

**Limites explícitos:** a V1.226 não altera a comissão de indicação direta
existente para primeiras compras qualificadas, não cria remuneração de
revenda por revenda, não credita saldos, não ativa saques e não presume
que um lead equivale a um cliente ou parceiro já habilitado.
A futura conversão em benefício exigirá confirmação administrativa e
análise do orçamento real por pedido. Sem provedor real de ofertas, a
página de indicações continua disponível sem criar transações.

## V1.227 — Visibilidade da rede no Admin

A área de **aquisição de clientes e parceiros** exibe dados agregados da
Rede TAMÃO: novos interessados que chegaram por indicações validadas,
origem (cliente/revenda), tipo de interesse (cliente/revenda), registros
marcados como convertidos no CRM e revendas com código de convite.
Administradores autorizados podem acompanhar um quadro resumido das
revendas que geraram contatos, sem revelar dados pessoais dos
interessados neste quadro.

Esta fonte é estritamente de **pré-cadastro consentido**, não uma
comprovação de compra, de habilitação da revenda ou de recebimento
de comissão. Contagem de "convertidos no CRM" representa unicamente
o estágio registrado pelo operador no CRM. O indicador de ganhos da rede
permanece desativado e não movimenta crédito ou dinheiro.

## V1.228 — Projeção econômica para indicar revendas

O Financeiro permite **simular** um incentivo hipotético de um nível, com
referência máxima de 5% da **taxa efetivamente recebida pelo TAMÃO**,
durante no máximo 90 dias e limitado a R$ 200,00 por empresa indicada.
Esses limites são parâmetros de modelagem, **não uma oferta comercial
ativada**.

A proposta compara a receita real da plataforma aos custos de cashback,
recompensas já reconhecidas, reserva variável, contribuição mínima e
benefícios anteriores. O menor valor entre percentual, margem
disponível e teto remanescente é apresentado como possibilidade apenas
ilustrativa. Valores negativos, números inválidos e cenários acima
do limite são rejeitados no navegador, Edge e PostgreSQL.

Uma restrição formal no banco impõe `reward_enabled=false`. A
API só pode **ler** a política e simular sob perfil Financeiro ou
Superadmin. O valor concedível permanece **R$ 0**, não há crédito,
comissão de parceiro, movimentação de saldo, pagamentos ou alterações
no livro razão.

Antes de considerar qualquer ativação, será necessário comprovar o
vínculo do cadastro indicado ao CNPJ habilitado, a taxa TAMÃO
**de fato recebida e conciliada**, ausência de estorno, vínculo
independente da empresa indicadora e aprovação financeira. O motor
imutável atual de crédito pré-pago também exige um caminho contábil
específico para concessões e reversões desse tipo.

## V1.229 — Convite vinculado ao cadastro real de empresa

O convite recebido no site `tamao.com.br` atravessa o redirecionamento
para `parceiro.tamao.com.br`, levando somente o código de referência.
O cadastro autenticado da revenda mostra um campo opcional de indicação
pré-preenchido. O backend valida o código e vincula o **primeiro cadastro
novo** de empresa ao CNPJ enviado, com unicidade do CNPJ na tabela
privada de atribuições. Correções e reenvios da mesma solicitação não
substituem quem indicou a empresa.

Um lead anterior com o mesmo código, telefone consentido e tipo
`merchant` é vinculado apenas como *candidato não verificado*; isso
não prova a identidade da empresa nem habilita remuneração. O backend
rejeita autoindicação identificável e indicação de empresa com o
mesmo CNPJ da revenda indicadora.

A área de Aquisição no Admin mostra cadastros com indicação,
aprovados, relacionados a CNPJ/proprietário e revendas ativas
correspondentes. Não apresenta essas etapas como comissão,
receita recebida ou venda liquidada.

Os dados são privados, com RPCs `security invoker` restritas ao
`service_role`. Toda associação permanece com `status=unverified`
e `reward_eligible=false` **impostos pelo banco**. A V1.229
não cria pagamento, crédito, saque ou alteração financeira.
