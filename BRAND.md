# TAMÃO — Brand System v1.0

## Essência

**TAMÃO** nasce da expressão brasileira **“tá na mão”**.

Promessa principal:

> **Pediu? Tá na mão.**

Descritor inicial:

> **Gás, água e essenciais perto de você.**

O TAMÃO não deve se apresentar como “app de gás”. Gás é a categoria de entrada. A marca representa uma plataforma local para encontrar, comparar e receber itens essenciais com clareza de preço, prazo e acompanhamento.

## Posicionamento

**Categoria:** marketplace local de essenciais.

**Proposta de valor:** encontrar operações locais elegíveis, comparar preço total e prazo, confirmar o pedido e acompanhar a entrega.

**Território emocional:** proximidade, confiança, praticidade e sensação de resolução.

**Território funcional:** preço + prazo + confirmação + acompanhamento.

## Arquitetura

- **TAMÃO** — marca-mãe.
- **TAMÃO Clube** — cashback e benefícios de compra.
- **TAMÃO Parceiro** — revendas e empresas.
- **TAMÃO Empresas** — futuras soluções B2B.
- Categorias permanecem descritivas: Gás, Água, Gelo, Carvão, Lenha e demais itens.

Evitar nomes como “TAMÃO Gás” como marca principal, porque limitam a expansão.

## Assinatura e mensagens

Assinatura principal:

**Pediu? Tá na mão.**

Mensagens aprovadas:

- **Acabou o gás? TAMÃO.**
- **Gás, água e essenciais perto de você.**
- **Compare. Escolha. Peça.**
- **Peça no TAMÃO.**
- **Venda no TAMÃO.**
- **Seu pedido, do aceite à entrega.**
- **Preço e prazo antes de confirmar.**

Evitar promessas absolutas de menor preço, entrega garantida, renda garantida ou prazo que não esteja comprovado pela operação real.

## Identidade visual

### Cores institucionais

| Papel | Cor | Hex |
| --- | --- | --- |
| TAMÃO Green | verde principal | #0D6B4B |
| TAMÃO Deep | verde profundo | #0A3E2D |
| TAMÃO Fresh | verde de apoio | #18A06B |
| Mão Gold | confirmação/energia | #F4B63F |
| Warm Paper | fundo | #F7F4EE |
| Card | superfície | #FFFDF8 |
| Ink | texto principal | #13261F |
| Muted | texto secundário | #65756C |

O amarelo deve funcionar como sinal de confirmação e energia, não como cor dominante.

### Símbolo

O ícone institucional combina **mão + confirmação** em um quadrado arredondado verde. A mão traduz literalmente “tá na mão”; o check representa pedido resolvido/confirmado.

Não usar chama como símbolo principal da marca. A chama pode permanecer como ícone da categoria **Gás**.

### Tipografia

Enquanto não houver família proprietária licenciada, usar a stack nativa do produto:

`Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`.

O nome TAMÃO deve aparecer em peso alto, caixa alta e espaçamento visual compacto.

## Tom de voz

O TAMÃO fala de forma:

- direta;
- brasileira;
- simples;
- próxima;
- confiável;
- sem jargão técnico desnecessário.

Preferir:

**“O parceiro precisa confirmar antes de sair.”**

Evitar:

**“A alocação operacional depende da confirmação assíncrona do merchant.”**

A marca pode ser descontraída na publicidade, mas deve ficar precisa e sóbria em pagamento, segurança, compliance, cancelamento e suporte.

## Jornadas

A home deve separar quatro intenções:

1. **Quero pedir agora** — compra.
2. **Quero entender melhor** — confiança e funcionamento.
3. **Quero ganhar benefícios** — cashback e indicação.
4. **Quero vender no TAMÃO** — parceria comercial.

Indicação e revenda não devem ser apresentadas como a mesma oportunidade.

## Uso local e expansão

No piloto, usar:

**TAMÃO • São Gabriel**

A cidade é contexto operacional, não parte fixa da marca. Isso permite expansão sem renaming.

## Compatibilidade técnica v1.48

A marca pública migra para TAMÃO, mas os seguintes identificadores continuam temporariamente com o prefixo legado para evitar regressões:

- variáveis de ambiente `CHAMA_*`;
- storage keys `chama-*`;
- nomes de crons `chama-*`;
- contratos server-side já implantados;
- nome técnico do repositório `gassg`.

Esses identificadores não são comunicação de marca. Uma futura migração interna deve ocorrer separadamente, com compatibilidade e rollback explícitos.

## Clearance

A adoção visual/técnica não substitui busca jurídica oficial. Antes de investimento relevante em mídia, domínio definitivo ou material físico, validar **TAMÃO/TAMAO** no INPI, domínios prioritários e canais sociais.
