# Chama São Gabriel — MVP PWA

Marketplace hiperlocal de gás e abastecimento essencial para São Gabriel/RS.

## Online

**Demonstração pública:** https://carloskk07.github.io/gassg/

A branch `main` é publicada no GitHub Pages somente depois dos gates automatizados.

Durante o piloto existem três entradas protegidas por parâmetros:

- Cliente real: `?live=1#home`
- Revenda real: `?merchant=1#merchant`
- Administração protegida: `?admin=1#admin`

O modo padrão continua sendo demonstração. Nenhum preço ou revenda fictícia é apresentado como dado real no modo live.

## Estado atual — v1.7.2

**Demonstração:** funcional.

**Backend multiusuário:** aplicado no projeto Supabase exclusivo do Chama.

**Piloto real:** tecnicamente preparado, mas ainda depende do onboarding e da validação ponta a ponta das primeiras revendas reais. O banco ainda não possui pedidos, revendas ou memberships de produção.

Antes de liberar usuários reais em volume, devem ser comprovados com contas reais:

1. login permanente da revenda e vínculo em `merchant_members`;
2. URLs de redirecionamento do Supabase Auth;
3. conversão de cliente anônimo para conta permanente por e-mail;
4. primeiro fluxo em dois dispositivos: cliente → revenda → entrega → pagamento + PIN → benefícios;
5. criar o primeiro administrador permanente na allowlist `platform_admins`;
6. processo operacional de cobrança/reembolso entre plataforma e revenda;
7. usar origem dedicada/custom domain antes de escalar sessões privilegiadas além do piloto protegido.

## O que já existe

### Cliente

- PWA mobile-first;
- Anonymous Auth no piloto para reduzir atrito;
- consulta de ofertas reais por Edge Function;
- cesta multiproduto sem obrigar P13;
- P13, água, carvão, lenha e gelo;
- preço e itens congelados em quote server-side;
- ofertas “Recomendado”, “Mais barato” e “Mais rápido” sem revelar a revenda;
- apenas um pedido ativo por cliente;
- re-cotação mais cara somente com aceite explícito;
- tracking server-side;
- PIN mostrado somente após saída real;
- cashback, fidelidade e indicação;
- conversão da conta anônima para identidade permanente sem trocar `user_id`.

### Revenda

- portal real separado da sessão do cliente;
- login passwordless por e-mail;
- sessão permanente da revenda limitada ao `sessionStorage` da aba no GitHub Pages;
- somente `owner`, `manager` e `operator` podem operar pedidos no piloto;
- papel `driver` permanece bloqueado até existir atribuição por pedido;
- endereço do cliente oculto antes do aceite;
- online/offline e heartbeat;
- preço/estoque P13;
- taxa de entrega e ETA;
- aceite, recusa, rescue pós-aceite, saída, chegada e conclusão;
- conclusão exige **pagamento confirmado + PIN correto**.

### Administração

- control plane real em `?admin=1#admin`;
- sessão própria, separada de cliente e revenda;
- login não cria conta automaticamente;
- autorização por allowlist `platform_admins`, nunca por `user_metadata`;
- aprovação de cadastro cria merchant `pending` e vincula o solicitante como `owner`, sem ativação automática;
- CNPJ verificado é obrigatório para ativação;
- P13 ativo exige também ANP verificada;
- conciliação de taxa, cashback e ajustes de reversão;
- reversão financeira e auditoria são atômicas no Postgres.

### Backend e segurança

O navegador não possui acesso direto às tabelas da aplicação. RLS permanece ativo e os grants/policies de `anon/authenticated` foram removidos do data-plane; toda leitura/escrita real passa por projeções ou autoridades Edge server-side.

Edge Functions atuais:

- `get-offers`
- `create-order`
- `get-order`
- `customer-action`
- `customer-summary`
- `merchant-orders`
- `merchant-action`
- `merchant-ops`
- `complete-delivery`
- `submit-merchant-application`
- `admin-ops`

Proteções implementadas:

- JWT validado em todas as Edge Functions;
- publishable key no browser; secret/service role nunca no frontend;
- dependências fixadas em versão;
- payload JSON limitado a 16 KB, inclusive streaming/chunked;
- quotas atômicas por usuário;
- idempotência de mutações;
- optimistic concurrency por `version`;
- snapshots atômicos de quote;
- rescue centralizado;
- preço, taxa e itens congelados em re-cotação;
- PIN com `pgcrypto`, cinco tentativas e retenção curta;
- service worker network-first com cache `v1.7.1`;
- sessões de revenda/admin isoladas por aba enquanto o piloto ainda usa o origin compartilhado do GitHub Pages.

## Confirmações de credibilidade do pedido

O sistema não avança por inferência de interface:

`OFFERED_TO_MERCHANT → PREPARING → OUT_FOR_DELIVERY → ARRIVING → SETTLED`

Cada mudança exige autoridade server-side. “A caminho” só aparece depois de `dispatch`; “Concluído” exige pagamento confirmado e PIN correto.

Se a revenda aceita e depois não consegue concluir, `cannot-fulfill` devolve o estoque reservado e inicia rescue atômico. Se a alternativa for mais cara, o cliente precisa aceitar a nova condição dentro da janela de re-cotação.

## Modelo financeiro v1.6

A unidade econômica é congelada na criação de cada pedido. Política inicial do piloto:

- taxa da plataforma: **7,5%** do valor bruto;
- reserva de custo variável: **0,75%**;
- contribuição mínima da plataforma: **2,5%**;
- cashback alvo: **1,0%**;
- indicação direta alvo: **2,0%**, apenas para aquisição do cliente;
- hold de comissão: **168 horas**.

Cashback e comissão são limitados pela receita real da plataforma. O banco possui constraint que impede os benefícios de romperem a contribuição mínima.

Quando cashback antigo é usado, o cliente paga menos, mas a revenda continua tendo direito ao valor cheio. Por isso o backend registra separadamente:

- taxa da plataforma a receber;
- cashback resgatado a reembolsar à revenda;
- ajustes de reversão;
- posição financeira líquida por revenda.

Comissão pode ficar pendente para um usuário anônimo, mas só amadurece para saldo disponível depois que o mesmo `user_id` vira identidade permanente.

## Reversões

Entrega operacional e liquidação financeira são estados diferentes. Um pedido entregue pode permanecer no histórico como `SETTLED` e depois ter `financial_state=reversed`.

Uma reversão server-side:

- estorna cashback concedido;
- retira comissão pendente ou disponível;
- reabre a elegibilidade da indicação quando aplicável;
- reverte a taxa da plataforma;
- trata reembolso de cashback já pago à revenda;
- mantém trilha de auditoria e é idempotente.

## Jobs automáticos

- `chama-order-watchdog`: a cada minuto;
- `chama-reward-maturation`: a cada hora;
- `chama-data-retention`: diariamente;
- `chama-anonymous-cleanup`: diariamente.

Usuários anônimos só são eliminados após 45 dias se não possuírem pedido, carteira, indicação, cadastro de revenda, membership ou identidade vinculada.

## Gates de release

O CI executa:

- sintaxe/checagem das Edge Functions;
- **34 simulações de domínio e falhas**;
- auditoria estática;
- contratos SQL/migrations;
- contratos de runtime;
- smoke em Chrome móvel;
- E2E completo em Chrome;
- validação do manifest/PWA.

Nenhuma mudança deve ir para `main` com gate vermelho.

## Limites deliberados do piloto

Ainda não são considerados concluídos:

- onboarding das três revendas reais e validação regulatória;
- geocodificação/roteamento real por rua em vez do escopo cidade;
- PSP/split/Pix payout automatizado;
- saque real de comissão;
- atribuição individual de motorista;
- bootstrap do primeiro administrador e validação das configurações de Auth;
- origem dedicada/custom domain para sessões privilegiadas antes de escalar o piloto;
- WhatsApp/push de produção;
- contratos, termos, privacidade e procedimento operacional final.

Veja também [AUDIT.md](./AUDIT.md), [supabase/README.md](./supabase/README.md), [supabase/API.md](./supabase/API.md) e [supabase/THREAT_MODEL.md](./supabase/THREAT_MODEL.md).
