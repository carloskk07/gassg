# Chama — Supabase backend v1.2

Este diretório contém a base do backend multiusuário do Chama. **Não deve ser aplicado ao projeto Reward Pulse.** O Chama precisa de um projeto Supabase próprio para manter dados, chaves, logs, quotas e RLS isolados.

## Decisões de arquitetura

- Clientes podem começar com **Supabase Anonymous Auth** para reduzir atrito no primeiro pedido.
- Revendas devem usar identidade permanente antes de operar pedidos reais.
- O frontend usa somente **publishable key**. Nunca existe `service_role`/secret key no navegador.
- Tabelas expostas usam **RLS em todas as superfícies**.
- O navegador tem acesso de leitura; mutações críticas serão realizadas por Edge Functions server-side.
- Valores monetários são inteiros em centavos.
- Cashback e comissões usam ledger imutável com `idempotency_key`.
- O PIN de entrega será armazenado apenas como hash.
- Para o primeiro piloto local, `orders` e `order_events` ficam preparados para Postgres Changes. Broadcast pode substituir a estratégia depois se o volume justificar.

## Por que não gravar pedidos diretamente do browser

Preço, cashback, estoque, status e comissões precisam de uma autoridade única. Permitir `INSERT/UPDATE` do cliente diretamente em `orders` abriria espaço para:

- alterar preço protegido;
- simular entrega;
- gerar cashback duplicado;
- reduzir ou aumentar estoque incorretamente;
- assumir pedido de outra revenda;
- forçar transições de estado inválidas.

Por isso o schema concede apenas `SELECT` ao papel `authenticated` nas tabelas críticas.

## Fluxo proposto

### Cliente

1. App inicia Anonymous Auth.
2. Consulta revendas e catálogo permitidos por RLS.
3. Envia pedido para Edge Function `create-order`.
4. Função recalcula valores no servidor, escolhe/valida a revenda, reserva cashback e cria pedido/eventos.
5. Cliente assina mudanças do próprio pedido.

### Revenda

1. Operador autentica com conta permanente.
2. RLS comprova vínculo em `merchant_members`.
3. Painel lê apenas pedidos da própria revenda.
4. Aceite, recusa, saída, chegada e conclusão passam por Edge Function `merchant-action`.
5. Função valida versão/status, estoque e idempotência antes de alterar qualquer linha.

### Entrega

1. Cliente vê o PIN somente após `OUT_FOR_DELIVERY`.
2. O servidor armazena somente hash.
3. Revenda envia o PIN para `complete-delivery`.
4. A função limita tentativas, verifica hash e faz settlement uma única vez.
5. Cashback/referral entram no ledger com chaves idempotentes.

## Aplicação do schema

O arquivo [schema.sql](./schema.sql) é um **bootstrap revisável**, não uma migration aplicada. Quando existir o projeto Supabase exclusivo do Chama:

1. habilitar Anonymous Sign-Ins com proteção antiabuso;
2. confirmar publishable key e URL do projeto;
3. aplicar o schema em ambiente de desenvolvimento;
4. rodar Security e Performance Advisors;
5. verificar cada policy com usuários de cliente, revenda e usuário sem vínculo;
6. somente depois gerar a migration canônica pelo fluxo oficial do Supabase;
7. implementar/deployar Edge Functions;
8. conectar o frontend e executar o E2E em dois navegadores/dispositivos distintos.

## Regras inegociáveis

- nenhuma secret key no GitHub Pages;
- nenhuma policy baseada em `user_metadata`;
- nenhuma tabela pública sem RLS;
- nenhuma escrita financeira sem idempotência;
- nenhuma transição de pedido aceita apenas porque o frontend pediu;
- nenhuma recompensa por recrutamento sem venda real validada;
- nenhum dado real de revenda misturado ao projeto Reward Pulse.
