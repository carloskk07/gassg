# TAMÃO — decisão operacional 16/11/2026: mínimo R$ 50 e termos em revisão

## Configuração aplicada em produção
Em 16/11/2026, a pedido expresso do proprietário, foi chamada a função existente `public.network_manual_payout_policy_set_v1_1034` com `minimum_cents=5000` e confirmação exigida `DEFINIR LIMITE`. Há exatamente um superadmin ativo, verificado antes da configuração. O retorno foi `minimumCents:5000`, `paymentDays:3`, `automaticPayouts:false`, `moneyMoved:false`; leitura de verificação confirmou 5000 centavos no banco. A função atribui `changed_by` e `changed_at` à trilha existente; nenhum pagamento foi criado ou executado.

**Esta é uma configuração operacional em produção, não uma migração de esquema:** o valor deve continuar ajustável por seletor oficial do Admin, e não deve ser codificado rigidamente em testes ou SQL de release.

## Situação comercial preservada
- `platform_launch_control.operation_mode=LIVE`, mas `platform_launch_control.commerce_enabled=false` (modo sozinho não libera transações).
- São Gabriel: `market_cities.commerce_enabled=false`; `admin_paused=false`.
- Fundo 10%: `accrual_enabled=false`, `payouts_enabled=false`, `terms_approved_at=NULL`.
- Publicidade Rede: `enabled=false`, `terms_approved_at=NULL`.
- Executor automático de saques: `execution_enabled=false`.
- **Captação/cadastro** de interessados é uma camada separada e não exige merchant ativo, venda real ou Pix de teste.

## Ações antes da apuração remunerada
1. Revisar e aprovar a minuta `docs/legal/draft-network-terms-2026-11-16.md`. Ela **não é** termo aprovado/publicado; nunca registrar este arquivo como versão vigente.
2. Publicar versão definitiva verificável, apresentar aviso/aceite adequado aos participantes e registrar referência de aprovação; avaliar conformidade jurídica e tributária antes de gerar obrigações remuneratórias.
3. Conferir a conciliação NET e a capacidade de suporte; ativar, por painel Superadmin, apenas **novas** apurações da modalidade liberada.
4. Manter os bônus Ads em trilha segregada e sem resgate enquanto não houver integração financeira expressamente testada.
5. Saques continuam manuais: saldo elegível, mínimo R$50, verificação de identidade/beneficiário, aprovação, Pix externo até 72 horas e comprovante.
6. Liberar cada venda de produtos apenas quando houver fornecedor/documentação/oferta/estoque/destinatário reais. Não habilitar globalmente comércio de produtos com revendas inexistentes e não inferir compra ativa do estado `LIVE`.
7. Não reabrir as 19 frentes técnicas pelo fato de faltar atividade comercial externa.

## Sem fatos financeiros artificiais
A configuração de mínimo não faz fundos aparecerem, não converte saldos Ads em resgatáveis, não promete saques imediatos, não executa Pix e não habilita checkout de produtos.
