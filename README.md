# Chama São Gabriel — MVP PWA

Marketplace local de gás e abastecimento para São Gabriel/RS.

## Status

- Código publicado na branch `main`.
- PWA estática pronta para GitHub Pages.
- Workflow automático em `.github/workflows/pages.yml`.
- URL esperada após habilitar Pages: `https://carloskk07.github.io/gassg/`.

## Ativar o site online uma única vez

No GitHub: **Settings → Pages → Build and deployment → Source → GitHub Actions**.

Depois, execute novamente o workflow **Deploy to GitHub Pages**. Os próximos pushes para `main` serão publicados automaticamente.

## O que já funciona

- Preço Agora e comparação de ofertas por endereço.
- Mais barato, Recomendado e Mais rápido.
- Carrinho multiproduto: P13, água, carvão, lenha e gelo.
- Pedido com preço protegido.
- Revenda precisa aceitar antes de o pedido aparecer como confirmado.
- Confirmação explícita de saída antes de exibir “A caminho”.
- PIN de quatro dígitos para comprovar entrega.
- Reatribuição automática quando uma revenda recusa.
- Cashback, Clube, indicação e área de parceiro.
- Cadastro de novas revendas.
- Painel de revenda com preço, estoque, pedidos e Trust Score.
- Manifest + service worker para instalação como PWA.

## Importante

Os nomes de revendas e preços atuais são demonstrativos até cadastrarmos os três parceiros reais. A versão atual usa `localStorage`, portanto serve para validar UX e fluxo em um único navegador. O próximo estágio é backend compartilhado para cliente e revendas em dispositivos diferentes.
