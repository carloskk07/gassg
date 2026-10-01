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


## Runtime v1.4 — piloto real protegido

O backend real já existe no projeto Supabase exclusivo do Chama (`lgugwujpunhslavewffd`) e não compartilha dados com Reward Pulse.

O site continua abrindo em **modo demonstração por padrão**. Para solicitar o runtime real durante o piloto, use:

`https://carloskk07.github.io/gassg/?live=1#home`

O modo live:
- tenta criar/restaurar uma sessão de cliente via Supabase Anonymous Auth;
- consulta apenas ofertas reais do Supabase;
- não usa os preços demonstrativos como se fossem reais;
- cria pedidos por quote server-side e idempotência;
- acompanha o pedido por uma projeção segura do backend;
- não revela a identidade da revenda antes do aceite;
- mostra o PIN somente quando o pedido realmente saiu para entrega;
- mantém o demo intacto se o modo live não for solicitado.

**Importante:** Anonymous Sign-Ins precisa estar habilitado no painel do Supabase antes de testar o cliente real. A área real da revenda exige identidade permanente e vínculo em `merchant_members`; ela ainda não é aberta automaticamente para parceiros sem aprovação.

### Autoridade operacional real

O Supabase atualmente possui:
- `get-offers`
- `create-order`
- `get-order`
- `customer-action`
- `merchant-orders`
- `merchant-action`
- `merchant-ops`
- `complete-delivery`
- `submit-merchant-application`

Todas as funções acima exigem JWT. Mutações financeiras/status críticas chegam ao banco através de RPCs server-side restritos ao `service_role`.

O banco também executa `chama-order-watchdog` a cada minuto para:
- resgatar pedidos sem aceite;
- marcar preparação atrasada como `AT_RISK`;
- registrar `ETA_RISK` quando a promessa máxima de entrega é ultrapassada.

Preços unitários são congelados também durante rescue/requote; uma troca de revenda não pode deixar `order_items` com preços da fornecedora anterior.
