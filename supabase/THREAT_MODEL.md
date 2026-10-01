# Chama — Threat model v1.6.7

Este documento define os principais riscos do piloto real e as mitigações já implementadas ou ainda obrigatórias.

## T1 — Cliente altera preço, cesta ou fornecedor

**Risco:** manipular JavaScript/payload para pagar menos ou trocar revenda.

**Mitigação:**
- ofertas criadas server-side;
- quote opaca;
- preço/itens/taxa persistidos em snapshot;
- criação do pedido ignora valores enviados pelo browser;
- data-plane não é legível diretamente pelo cliente.

## T2 — Retry ou clique duplo duplica pedido/dinheiro

**Mitigação:**
- idempotency key;
- fingerprint canônico;
- `action_requests`;
- unique index de um pedido ativo por cliente;
- conflito concorrente mapeado para 409;
- ledger com `idempotency_key` única.

## T3 — Corrida de estoque

**Mitigação:**
- estoque revalidado no quote;
- revalidado novamente antes do aceite;
- reserva atômica por item;
- rollback transacional;
- rescue recompõe estoque quando a revenda falha antes da saída.

## T4 — Revenda opera pedido alheio

**Mitigação:**
- identidade permanente;
- membership server-side;
- pedido precisa pertencer ao merchant;
- owner/manager/operator são os únicos papéis operacionais no piloto;
- Edge e RPC repetem a autorização.

## T5 — Driver vê/opera qualquer pedido

**Risco:** papel `driver` sem assignment individual poderia acessar endereço ou alterar status.

**Mitigação atual:**
- `driver` é rejeitado por `merchant-orders`, `get-order` e RPCs de mutação;
- futura liberação exige tabela de assignment por pedido/driver.

## T6 — Identidade da revenda vaza antes do aceite

**Mitigação:**
- browser não enumera merchants/catalog;
- `get-offers` anonimiza;
- `merchant_id` nunca aparece na oferta;
- fornecedor só é mostrado ao cliente após aceite.

## T7 — Endereço do cliente vaza antes da necessidade

**Mitigação:**
- oferta não devolve endereço a revenda;
- merchant queue mascara endereço em `OFFERED_TO_MERCHANT`;
- get-order aplica a mesma regra;
- browser não tem acesso direto a `orders`.

## T8 — Status falso para criar confiança artificial

**Risco:** UI afirmar “aceito”, “a caminho” ou “entregue” sem confirmação real.

**Mitigação:**
- máquina de estados server-side;
- `version` para concorrência;
- `dispatch` é o único caminho para OUT_FOR_DELIVERY;
- `arriving` exige OUT_FOR_DELIVERY;
- cada transição gera evento.

## T9 — Falsa entrega libera benefícios

**Mitigação:**
- status precisa chegar a ARRIVING;
- PIN só nasce no dispatch;
- PIN bruto isolado e retido por tempo curto;
- hash SHA-256 no pedido;
- cinco falhas;
- settlement exige **PIN correto + pagamento confirmado**.

## T10 — PIN bruto permanece tempo demais

**Mitigação:**
- segredo separado do pedido;
- consumido no settlement;
- retenção elimina segredo de pedido encerrado após 1 hora.

## T11 — Requote muda preço silenciosamente

**Mitigação:**
- snapshot de itens;
- taxa de entrega congelada;
- proposta expira em 5 minutos;
- qualquer aumento exige ação explícita do cliente;
- watchdog cancela proposta abandonada.

## T12 — Resposta assíncrona antiga sobrescreve nova

**Mitigação:**
- sequência de requests no frontend;
- snapshot de endereço/cesta;
- versão do pedido;
- polling pausa durante mutações.

## T13 — Bot cria quotes e cresce banco/endereço

**Mitigação:**
- quota por minuto;
- quota por hora;
- body limitado;
- snapshot idêntico reutilizado por fingerprint;
- advisory lock evita quote duplicada concorrente;
- quote expirada removida em 2 horas.

## T14 — Anonymous Auth é usado para farming

**Mitigação:**
- rate limit server-side;
- referral nunca paga apenas por cadastro;
- comissão nasce somente de settlement;
- comissão sacável exige identidade permanente;
- referral novo só pode ser ligado antes do primeiro pedido;
- usuários anônimos antigos sem histórico são eliminados após 45 dias.

**Pendente antes de abertura ampla:** CAPTCHA/Turnstile no fluxo de criação anônima.

## T15 — Autoindicação ou referral tardio vira custo de retenção

**Mitigação:**
- `referred_user_id <> referrer_user_id`;
- nova relação de referral somente quando ainda não existe pedido anterior;
- relação é única por cliente;
- comissão direta somente no primeiro settlement elegível.

## T16 — Rewards consomem toda a margem

**Mitigação:**
- taxa da plataforma snapshotada;
- reserva variável;
- contribuição mínima;
- cashback/referral limitados por reward budget;
- constraint de identidade financeira;
- nenhum reward calculado pelo browser.

## T17 — Cashback usado deixa a revenda recebendo menos

**Mitigação:**
- customer paga `gross - cashback_reserved`;
- cashback resgatado gera `merchant_cashback_reimbursements`;
- taxa a receber e cashback a pagar são registrados separadamente;
- posição líquida da revenda é calculável server-side.

## T18 — Venda é revertida depois que benefícios foram liberados

**Mitigação:**
- status operacional e `financial_state` são separados;
- `reverse_settled_order_financials` é idempotente e server-only;
- cashback é estornado;
- comissão pending/available é revertida;
- referral pode voltar a ficar elegível;
- receivable da plataforma é revertido;
- dinheiro já liquidado vira ajuste financeiro explícito;
- maturação e reversão compartilham lock por pedido.

## T19 — Comissão amadurece durante reversão

**Mitigação:**
- advisory lock por pedido;
- order + reward grant são rechecados sob lock;
- maturação exige `financial_state=settled`;
- grant revertido não amadurece.

## T20 — Comissão em dinheiro vai para identidade descartável

**Mitigação:**
- pending pode preservar atribuição;
- `process_reward_maturation` exige `auth.users.is_anonymous=false`;
- cliente pode vincular e-mail mantendo o mesmo `user_id`.

**Dependência operacional:** Manual Linking precisa estar habilitado no Supabase Auth.

## T21 — Chave privilegiada aparece no GitHub Pages

**Mitigação:**
- frontend contém apenas publishable key;
- CI procura padrões proibidos;
- secrets usados apenas por Edge Functions;
- browser não possui grants de tabelas nem EXECUTE de autoridades privilegiadas.

## T22 — Payload grande ou loop derruba Edge Functions

**Mitigação:**
- JSON máximo de 16 KB;
- leitura streaming com limite;
- quota server-side fail-closed;
- dependências fixadas.

## T23 — Cadastro falso de revenda

**Mitigação:**
- CNPJ normalizado;
- duplicidade bloqueada;
- aplicação fica `pending`;
- cadastro nunca ativa merchant;
- ativação exige validação operacional/regulatória fora do formulário público.

## T24 — Papel operacional permanece online sem operador elegível

**Mitigação:**
- heartbeat exige owner/manager/operator;
- merchant stale deixa de ser elegível;
- preço também expira;
- estoque precisa estar disponível para ficar online.

## T25 — Exclusão automática apaga histórico legítimo

**Mitigação:**
`process_anonymous_user_cleanup` só remove Anonymous Auth antigo se não existir:

- identity;
- e-mail/telefone;
- pedido;
- wallet;
- referral;
- merchant application;
- merchant membership.

## T26 — Dados sensíveis em log

**Regra:**
- nunca registrar JWT;
- PIN;
- secret key;
- endereço completo;
- dados financeiros desnecessários.

Edge Functions devem logar erro técnico mínimo e devolver mensagens sanitizadas.

## Dependências ainda abertas antes do go-live público

- CAPTCHA/Turnstile;
- PSP/split/payout;
- KYC/regra jurídica para saque;
- painel admin auditado;
- assignment de motorista;
- geocodificação/ETA de produção;
- monitoramento/alertas;
- LGPD/termos/contratos;
- primeiro E2E multi-dispositivo com parceiro real.

## Gate de dinheiro sacável

Saque Pix continua bloqueado até existirem, juntos:

- identidade permanente;
- PSP adequado;
- antifraude;
- reconciliação;
- limite/cooldown;
- reversão;
- procedimento de disputa;
- trilha auditável;
- operação financeira validada.
