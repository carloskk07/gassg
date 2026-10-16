# TAMÃO V1.347 — Experiência premium sem promessas artificiais

16 de outubro de 2026.

## Objetivo
Corrigir o caminho da primeira visita, dar protagonismo ao catálogo e colocar a proposta de valor da revenda antes das explicações extensas. Reduzir o atrito sem mudar as autoridades comerciais.

## Mudanças

- CTA principal quando não existem ofertas verificadas agora aponta ao explorador visual de produtos, em vez de abrir automaticamente o checkout com P13 na cesta.
- Explorador de produtos com categorias (destaques, gás, água e outros), rótulos semânticos e estado `aria-pressed`; carrega apenas SKUs admitidos pela lógica atual de visibilidade do catálogo. Mostra no máximo seis destaques inicialmente; os filtros revelam outros produtos daquele grupo. A lista é limitada a 24 entradas para proteger renderização em aparelhos modestos.
- Classificação da categoria respeita o registro do catálogo quando presente; códigos legados têm classificação de fallback segura.
- Ilustração editorial da home usa a arte já autorizada do próprio repositório, sem valores fictícios, personagens, supostos vendedores ou ordens reais. A legenda explica que não há compra sem validação posterior por CEP.
- Landing de revendas com hero em duas colunas e CTA mais cedo, seguido de recursos reais da plataforma apresentados como ilustração. A comunicação preserva cadastro, revisão administrativa e comprovação de habilitação.
- Estilos responsivos com layouts específicos para telas estreitas, controles com área mínima de toque e redução de movimento.

## Invariantes
- Sem alterações SQL, Edge Functions, PSP, taxas, bônus, publicações automáticas, flags de cidades, saldos, elegibilidade comercial ou contratos financeiros.
- `homeFilterProducts` altera apenas visibilidade DOM dos cartões já mostrados pela UI; não altera carrinho, preços, estoque ou pedidos.
- `homeDiscoverFocus` apenas rola a home para o catálogo. A entrada no checkout continua passando pelo fluxo antigo e pelos bloqueios do servidor.
- A ilustração não representa ofertas, prazos, valores, volume real de pedidos ou certificação de fornecedor.
- Nenhuma cidade é aberta automaticamente, e não há novos fluxos de pagamentos.
- `tests/premium-experience-v1-347.mjs` cobre semântica, filtros, foco, CTA, modo sem oferta e segurança do catálogo.

## Critérios de aceitação para publicação
1. Testes do workflow `Audit` e `Build isolated live portals` aprovados, incluindo a navegação no navegador nas dimensões 320/360/390 px.
2. Deploy oficial e reconciliação Cloudflare confirmados; conferir o `sourceSha` dos três `portal-build.json` quando o navegador ou monitor de origem estiver disponível.
3. Inspeção visual manual de home sem ofertas e com ofertas, home demo, landing comercial, parceiros autenticados e admin autorizado. Testes estáticos não substituem essa inspeção.
4. Não atribuir aumento de CTR, taxa de conversão ou vendas até existir experimento real com base de medição válida.
