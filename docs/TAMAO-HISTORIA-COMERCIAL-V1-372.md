# TAMÃO V1.372 — Páginas públicas com história comercial clara

Data: 17/10/2026.

## Objetivo
Evoluir a home e as páginas de visita para que clientes, revendas e marcas entendam a proposta de valor rapidamente, sem múltiplos blocos competindo pelo mesmo clique. Incremento visual compatível com a identidade TAMÃO e com o catálogo e pagamentos existentes.

## Evidência no código
- A home já privilegia o CTA acima dos filtros na V1.371, mas a primeira visita ainda não tinha uma explicação curta de como passar da escolha para a entrega.
- A página de patrocinadores tinha estrutura predominantemente textual, com três opções de campanha apresentadas apenas abaixo da primeira dobra.
- O painel ilustrativo da revenda explicava pedidos, catálogo e rede, mas não mostrava junto o modelo atual de taxa por conclusão e ausência de mensalidade.

## Alterações
1. **Home** — faixa editorial com três etapas: escolha livre do produto, verificação por CEP e confirmação com aceite da revenda, renderizada apenas na primeira visita sem ofertas confirmadas.
2. **Marcas** — hero dividido entre proposta comercial e uma representação gráfica da construção de uma campanha. Região, categoria, publicidade identificada e condições comerciais são apresentados com hierarquia própria.
3. **Revendas** — cartão-resumo de condições no hero ilustrado: sem mensalidade, taxa percentual configurada por pedido concluído e clareza sobre disponibilidade e habilitação.
4. **Design adaptativo** — cards compactos em 320–390 px, colunas flexíveis no desktop, empilhamento em tablets, contraste e identidade visual consistentes.

## Segurança comercial
- Ilustração de anúncio **não é** campanha real, inventário de patrocinadores, promessa de alcance, resultado ou audiência. Rótulo visível informa isso.
- Não criamos pedidos, orçamentos, leads ou ações patrocinadas automaticamente.
- O percentual de taxa vem da política comercial já usada na landing da revenda; não há valor arbitrário novo.
- A escolha de produto continua sem gás obrigatório e a oferta só existe após as verificações de CEP, operação e revenda.
- Nenhuma alteração em Supabase, Edge Functions, PSP, cashback, comissões, promoções, abertura de cidade, pagamentos, estoque, permissões e autorizações do administrador principal.

## Critérios de aceitação
- `node tests/public-storytelling-v1-372.mjs` passa junto dos contratos anteriores.
- GitHub Actions `Audit` e `Build isolated live portals` passam.
- Navegação mobile sem overflow, títulos legíveis, botões alcançáveis e campanhas identificadas como conceituais.
- Publicação em `tamao.com.br` deve ser conferida pelo workflow oficial e por `portal-build.json`; PR integrada não prova atualização imediata do site.
- Não atribuir ganho de CTR/conversão antes de dados reais ou teste controlado.
