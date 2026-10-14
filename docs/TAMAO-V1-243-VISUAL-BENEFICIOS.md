# TAMÃO V1.243 — Imagens de produtos e benefícios comerciais

## Recursos gráficos publicados
- Sprite otimizado `assets/tamao-products-sprite.webp` com imagens realmente geradas para 5 famílias: botijão P13 (ilustrativo), galão de água 20 L, saco de carvão, lenha e gelo.
- Imagens exibidas no destaque, vitrine e cesta do cliente e no catálogo interno e real da revenda.
- P20, P45, outros códigos dinâmicos e vasilhames não usam a foto de P13 como se fossem do mesmo tamanho: recebem fallback por emoji.
- O sprite é uma imagem ilustrativa sem logotipo, não altera nome, fornecedor, marca, capacidade, estoque, ofertas ou preço.
- Compressão e cache mantêm impacto de rede baixo: único arquivo WebP com cinco representações, sem requisições externas.
- `build-live-portals` e `build-public-site` agora incluem o diretório estático `assets` e o service worker versionado inclui o WebP.

## Mensagem comercial e conversão
- Home: valor concreto de comprar bem (CEP, oferta por cesta, aceite e rastreamento) + Rede TAMÃO com convites para clientes e revendas, sem prometer renda.
- Área de clientes/indicações: link pessoal, eventos de primeira compra qualificada e diferenciação entre benefício disponível e potencial.
- Área para revendas: autonomia, preços, estoque, entrega, recebimento direto, mais um canal de vendas, cesta ampliada, indicadores e indicações.
- Nova rota `#sponsors` — página para marcas/parceiros: oportunidades regionais, eventual publicidade identificada, Clube TAMÃO ainda em negociação, fluxo comercial e contato sem compromisso.
- Navegação no topo/rodapé para patrocinadores; linguagem mais natural e positiva; cards de valor com títulos escaneáveis.
- Nenhum depoimento fictício, cliente inexistente, venda inventada, campanha ativada, comissão garantida, comprovante falsificado ou desconto inexistente.

## Restrições preservadas
- Oferta apenas quando realmente verificada para o CEP/cesta; preço e prazo antes de pedido real, sem criar pedido automático.
- Clube patrocinado V1.239–V1.242 continua com venda/emissão/resgate bloqueados.
- TAMÃO Ads, Pro e comissões de rede ainda não são apresentados como contratáveis/garantidos.
- Qualquer valor para marcas é hipotético até documentação jurídica, origem da verba e homologação.
- Banner e cartão fotográficos representam categorias, não foto ou marca dos produtos de determinada revenda.
