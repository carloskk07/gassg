# Auditoria v1.6.7 — Chama São Gabriel

Data: 01/10/2026

## Status

**READY_FOR_PROTECTED_ONLINE_PILOT**

O runtime multiusuário, o banco e as Edge Functions estão implantados e os gates automatizados passam. O modo live permanece escondido atrás de parâmetros de piloto.

**NOT_YET_APPROVED_FOR_PUBLIC_REAL-MONEY LAUNCH**

O bloqueio atual não é mais a arquitetura básica. Falta validar configuração de Auth e executar o primeiro E2E real com revenda/cliente em dispositivos separados, além do onboarding regulatório e do procedimento de conciliação financeira.

Na última verificação o banco de produção do Chama possuía **0 pedidos, 0 revendas, 0 memberships e 0 aplicações reais**, portanto não houve migração destrutiva de dados operacionais.

## Evidência automatizada

- 34 simulações de domínio/falhas;
- auditoria estática de assets e superfícies de confiança;
- contratos de schema/migrations/runtime;
- Deno check das Edge Functions;
- smoke em Chrome móvel;
- E2E em Chrome cobrindo cesta → pedido → aceite → saída → chegada → pagamento + PIN → cashback;
- validações de acessibilidade, XSS, IDs duplicados, overflow e erros de console;
- service worker/manifest validados.

## Achados críticos eliminados nesta rodada

### Segurança e privacidade

- Data API do browser fechado: zero grants diretos de tabelas para `anon/authenticated`;
- zero `SECURITY DEFINER` da aplicação executável por browser;
- endereço oculto da revenda antes do aceite;
- papel `driver` bloqueado enquanto não existe assignment individual;
- payload limitado a 16 KB;
- rate limit atômico server-side;
- dependências fixadas;
- referral code aleatório, não derivado do UUID;
- Anonymous Auth antigo limpo somente com critérios conservadores.

### Pedido e concorrência

- quote + itens gravados atomicamente e reutilizados por fingerprint;
- resposta stale não sobrescreve pesquisa nova no frontend;
- polling não disputa com mutação ativa;
- índice único impede dois pedidos ativos do mesmo cliente;
- corrida de índice vira 409, não 500;
- rescue após aceite recompõe estoque;
- recusa e falha pós-aceite usam uma única autoridade de rescue;
- re-cotação congela itens + taxa, expira em 5 minutos e exige aceite;
- watchdog trata aceite, requote, preparação e ETA.

### Entrega

- geração/validação de PIN corrigida para o schema `extensions`;
- PIN usa entropia criptográfica e hash SHA-256;
- cinco falhas bloqueiam o PIN;
- PIN bruto de pedido encerrado é apagado após 1 hora;
- PIN correto não basta: settlement exige confirmação explícita de pagamento;
- PAYMENT_CONFIRMED, DELIVERED e SETTLED são eventos distintos.

### Financeiro

- rewards nascem somente de SETTLED real;
- unidade econômica congelada por pedido;
- taxa 7,5%, reserva variável 0,75%, contribuição mínima 2,5%;
- cashback alvo 1% e referral alvo 2%;
- constraint impede benefícios acima do orçamento;
- indicação nova só pode ser atribuída antes do primeiro pedido;
- comissão fica pendente por 168h;
- comissão não amadurece para identidade anônima;
- cashback resgatado gera reembolso a pagar à revenda;
- taxa da plataforma e reembolso de cashback são contas separadas;
- reversão pós-settlement estorna ledger, comissão e recebíveis;
- reversão e maturação usam lock comum para impedir corrida.

## Estado dos Advisors

### Security Advisor

Os avisos restantes são compatíveis com o desenho atual:

- `RLS enabled no policy` nas tabelas da aplicação é **intencional**, porque o browser não possui grants e o data-plane é server-only;
- warnings em `cron.job` / `cron.job_run_details` pertencem ao `pg_cron` gerenciado.

### Performance Advisor

Os avisos atuais são índices ainda não utilizados. Isso é esperado com banco sem tráfego real; eles não devem ser removidos antes do piloto produzir evidência de uso.

## Jobs ativos

- watchdog de pedido: 1 minuto;
- maturação de comissão: horário;
- retenção de dados efêmeros: diária;
- limpeza segura de usuários anônimos: diária.

## Dependências operacionais antes do primeiro pedido real

1. cadastrar uma revenda real e validar CNPJ/ANP;
2. criar conta permanente do operador;
3. vincular essa conta em `merchant_members`;
4. confirmar no Supabase Auth o Site URL/Redirect URL do GitHub Pages;
5. confirmar que Manual Linking está habilitado para converter Anonymous Auth em conta permanente;
6. cadastrar catálogo/estoque/ETA/taxa reais;
7. executar teste em dois aparelhos;
8. conferir no banco order events, ledger, receivable e cashback reimbursement;
9. documentar como a plataforma cobrará a taxa e reembolsará cashback usado;
10. só então ativar mais parceiros.

## O que ainda não existe de propósito

- saque Pix efetivo;
- PSP/split automático;
- assignment de motorista;
- geofence/prova GPS;
- painel admin completo;
- automação WhatsApp/push;
- Trust Score alimentado por volume real;
- contrato/termos/política LGPD final.

## Regra de release

`main` só pode receber mudança com CI verde. O primeiro go-live real exige, além do CI, um E2E multiusuário com evidência do Supabase.
