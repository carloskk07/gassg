# Chama — Threat model v1.2

Este documento define riscos obrigatórios do piloto real e a mitigação mínima antes de liberar usuários fora da demonstração.

## T1 — Cliente altera preço ou fornecedor no navegador

**Ataque:** editar JavaScript/local storage/payload e enviar total menor ou outra revenda.

**Mitigação:**
- ofertas vêm de `get-offers`;
- quote é opaco, server-side e expira;
- `create-order` ignora preços enviados pelo cliente;
- itens/preços vêm de `quote_items`;
- cliente não lê `merchants`, `catalog_items`, `quotes` nem `quote_items`.

**Gate:** nenhuma escrita direta do browser em `orders`.

## T2 — Duplo clique / timeout cria dois pedidos ou dois cashbacks

**Ataque:** retry de rede, clique repetido, refresh ou automação envia a mesma ação múltiplas vezes.

**Mitigação:**
- `Idempotency-Key` obrigatória;
- `action_requests` grava chave + hash do payload + resultado;
- mesma chave e mesmo payload retorna o resultado anterior;
- mesma chave com payload diferente retorna conflito;
- ledger financeiro também possui `idempotency_key` única.

## T3 — Corrida de estoque

**Ataque:** dois clientes compram a última unidade quase ao mesmo tempo.

**Mitigação:**
- validação final de estoque no servidor;
- reserva de todos os itens em transação;
- pedido usa `version` para optimistic concurrency;
- estoque nunca fica negativo;
- aceite só confirma depois da reserva.

## T4 — Revenda tenta operar pedido de outra revenda

**Ataque:** operador altera `orderId` no request.

**Mitigação:**
- usuário permanente;
- vínculo ativo em `merchant_members`;
- Edge Function verifica merchant atribuído;
- RLS impede leitura de pedido alheio;
- toda ação grava actor/user no evento.

## T5 — Cliente descobre identidade da revenda antes do aceite

**Ataque:** enumera tabela de revendas, catálogo ou relaciona quote com merchant.

**Mitigação:**
- clientes não têm policy para ler cadastro/catálogo;
- `get-offers` devolve somente oferta anonimizada;
- quote token não expõe merchant;
- nome entra em `supplier_name_snapshot` após aceite real.

## T6 — Falsa entrega para liberar cashback/comissão

**Ataque:** revenda marca entregue sem estar no local ou repete settlement.

**Mitigação:**
- status precisa chegar a `ARRIVING`;
- PIN mostrado apenas quando entrega está em andamento;
- banco armazena somente hash do PIN;
- máximo de cinco tentativas;
- settlement idempotente;
- cashback/referral só após settlement.

## T7 — Cliente compartilha PIN antecipadamente

**Risco:** fraude social, não apenas técnica.

**Mitigação:**
- UI: “informe somente com o pedido na sua frente”;
- PIN aparece somente em `OUT_FOR_DELIVERY/ARRIVING`;
- suporte pode bloquear disputa;
- fase futura: geofence/entregador autenticado como evidência adicional.

## T8 — Cashback/referral farming

**Ataque:** múltiplos usuários anônimos, autoindicação, pedidos simulados, cancelamentos coordenados.

**Mitigação:**
- `referred_user_id <> referrer_user_id`;
- comissão só em pedido real `SETTLED`;
- ledger permite reversão auditável;
- Anonymous Auth protegido por CAPTCHA/rate limit;
- limites financeiros e regras antifraude server-side antes de habilitar saque real;
- contas de revenda nunca podem gerar comissão pela própria venda sem regra explícita.

## T9 — Exposição de endereço do cliente

**Ataque:** revenda ou log acessa endereço sem necessidade.

**Mitigação:**
- RLS mostra pedido somente ao cliente e revenda atribuída;
- nenhuma listagem pública de pedidos;
- logs não registram endereço completo;
- suporte/admin deve usar acesso auditado;
- retenção de endereço será definida antes do go-live.

## T10 — Chave privilegiada vaza no frontend

**Ataque:** secret/service key é publicada no GitHub Pages.

**Mitigação:**
- frontend recebe apenas publishable key;
- secret/service key existe apenas em Edge Function;
- CI procura padrões de secret no repositório;
- RLS permanece ativo como defesa adicional.

## T11 — Cadastro de revenda falso ou duplicado

**Ataque:** terceiros registram CNPJ de outra empresa ou inundam onboarding.

**Mitigação:**
- CNPJ normalizado, inclusive formato alfanumérico;
- índice único para aplicação pendente/aprovada;
- ativação não é automática;
- verificação documental e regulatória antes de `merchant.status=active`.

## T12 — Estado de pedido fora de ordem

**Ataque/falha:** “A caminho” antes do aceite, entrega antes da chegada, requote silencioso.

**Mitigação:**
- máquina de estados server-side;
- `expectedVersion`;
- toda transição gera evento;
- aumento de preço exige `REQUOTE_REQUIRED` e aceite do cliente;
- `dispatch` é o único comando que produz `OUT_FOR_DELIVERY`.

## T13 — Scraping/abuso do comparador

**Ataque:** bot consulta ofertas continuamente para mapear preços/revendas ou gerar carga.

**Mitigação:**
- ofertas anonimizadas;
- quote curto;
- rate limiting por usuário/sessão/IP no edge;
- CAPTCHA quando o padrão for abusivo;
- nenhuma identidade comercial exposta pelo endpoint de ofertas.

## T14 — Falha de rede durante uma transição

**Risco:** usuário não sabe se a ação ocorreu e repete.

**Mitigação:**
- idempotência;
- resposta recuperável por chave;
- Realtime atualiza o estado depois;
- UI nunca assume sucesso antes de resposta/estado confirmado.

## Requisitos antes de dinheiro sacável

Saque Pix de comissão não deve ser ativado antes de existirem:

- ledger imutável;
- KYC/regra jurídica compatível com o modelo real;
- antifraude;
- reconciliação;
- limites e cooldown;
- reversão/disputa;
- observabilidade e alertas;
- trilha de auditoria de decisões financeiras.

O sistema pode demonstrar benefícios antes disso, mas não deve simular que existe um saldo sacável real em produção.
