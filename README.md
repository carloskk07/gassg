# Chama São Gabriel — MVP PWA

Marketplace hiperlocal de gás e abastecimento para São Gabriel/RS.

## Online

**https://carloskk07.github.io/gassg/**

A aplicação é publicada automaticamente pela branch `main` via GitHub Pages. O deploy só acontece depois que os gates automatizados passam.

## Estado atual

**Online demo:** funcional.

**Piloto multiusuário real:** ainda não está ativado. A arquitetura do backend já está preparada em `supabase/`, mas só será aplicada em um projeto Supabase exclusivo do Chama, separado do Reward Pulse.

A auditoria técnica completa está em [AUDIT.md](./AUDIT.md). O contrato de backend está em [supabase/README.md](./supabase/README.md), [supabase/API.md](./supabase/API.md) e [supabase/THREAT_MODEL.md](./supabase/THREAT_MODEL.md).

## Fluxos implementados

- Preço Agora e comparação de ofertas.
- Mais barato, Recomendado e Mais rápido.
- Carrinho multiproduto sem obrigar P13.
- P13, água, carvão, lenha e gelo.
- Preço protegido.
- Aceite explícito da revenda.
- Prazo de aceite e reatribuição.
- Preparação com deadline operacional.
- Confirmação explícita de saída antes de exibir “A caminho”.
- Risco de atraso visível ao cliente.
- PIN de quatro dígitos para prova de entrega.
- Cashback e Clube.
- Indicação com link pessoal.
- Cadastro de novas revendas, inclusive CNPJ alfanumérico.
- Painel de revenda, estoque e Trust Score.
- PWA instalável com service worker.

## Testes de release

- testes de sintaxe;
- simulações de domínio/falhas;
- auditoria estática;
- smoke em Chrome móvel;
- E2E completo em Chrome;
- validação do manifest PWA.

> Nomes, preços, distâncias e ETAs atuais são demonstrativos até conectarmos os três parceiros reais.
