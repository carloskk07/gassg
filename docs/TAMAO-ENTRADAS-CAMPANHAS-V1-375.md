# TAMÃO V1.375 — Links inteligentes de aquisição e boas-vindas por categoria

Data: 17/10/2026.

## Diagnóstico
O TAMÃO já possui páginas comerciais separadas, etiquetas UTM, referências por `ref` e medição agregada de entrada. Porém, um link de anúncio ou WhatsApp direcionado para `tamao.com.br/` não distinguia o interesse explícito de um consumidor procurando água, uma revenda querendo vender, uma marca desejando patrocinar ou uma pessoa interessada na rede de indicações.

## Contrato simples para links de divulgação
O parâmetro **`entrada`** é uma palavra de uma lista fechada. Funciona somente no portal público TAMÃO:

| Link de entrada | Resultado permitido |
|---|---|
| `https://tamao.com.br/?entrada=revenda` | Abre `#merchants`, a landing pública de revendas com o formulário existente |
| `https://tamao.com.br/?entrada=marca` | Abre `#sponsors`, a landing pública de campanhas patrocinadas |
| `https://tamao.com.br/?entrada=indicar` | Abre `#earn`, explicações da Rede TAMÃO |
| `https://tamao.com.br/?entrada=agua` | Mantém a home, destaca água **somente quando existe item correspondente no catálogo público consultável** |
| `https://tamao.com.br/?entrada=gas` | Mantém a home, destaca gás **somente quando existe item correspondente no catálogo público consultável** |

O destaque de produto não seleciona item automaticamente nem inicia pedido: o visitante clica para explorar a categoria, e o produto deve ser escolhido por ação explícita. A disponibilidade e o preço só são apresentados segundo os requisitos existentes de CEP, estoque, operação e revenda.

### Exemplos combinados com campanhas
- `https://tamao.com.br/?entrada=revenda&utm_source=instagram&utm_medium=cpc&utm_campaign=revendas_regionais`
- `https://tamao.com.br/?entrada=agua&utm_source=google&utm_medium=cpc&utm_campaign=busca_agua`
- `https://tamao.com.br/?entrada=indicar&ref=SEU_CODIGO_VALIDO&utm_source=whatsapp&utm_medium=referral`

As UTMs são preservadas no URL e na medição agregada existente. O parâmetro `ref` permanece na URL, mas o código só pode gerar atribuição e remuneração após as validações do fluxo de indicações no banco. `SEU_CODIGO_VALIDO` é um exemplo de espaço reservado, não um código real.

## Segurança e precedência
- `#home`, `#order`, `#contact` ou qualquer outra rota explícita ganha prioridade: `entrada` não sequestra links internos ou compartilhados.
- Somente `revenda`, `marca` e `indicar` podem alterar a rota inicial; valores inesperados, URLs externas e `admin`/ `merchant` nunca passam. Sem redirecionamento para domínio externo.
- Não interfere nos portais administrativos, de revendas, de teste ou ambiente interno.
- Acesso público não concede privilégios. Nenhuma taxa, produto, oferta, lead, pedido, promoção, preço, comissão, disponibilidade, forma de pagamento ou autorização comercial foi modificada.
- O catálogo e os avisos continuam condicionados às regras reais. Não há promessas inventadas de alcance, CTR, aquisição ou conversão.
- Medição de `landing_view` continua a usar a rota final depois da escolha da página. Não introduz armazenamento, identificadores ou coleta de dados pessoais.

## Validação e publicação
- `node tests/public-landing-entry-v1-375.mjs`: matriz de intents autorizados, UTM/ref conservados, respeito ao hash explícito, bloqueio de admin/merchant, sem seleção automática de produtos, ocultação da promoção contextual quando a categoria não estiver no catálogo, CSS responsivo e foco.
- Passar `Audit`, `Build isolated live portals` e testes de browser mobile da PR.
- Integração GitHub e publicação Cloudflare são etapas independentes; conferir as tarefas oficiais antes de declarar produção.
- Resultados reais em CTR/conversão dependem de análise agregada antes/depois ou teste controlado: a alteração técnica não prova eficácia comercial.
