# TAMÃO V1.1041 — Benefícios por módulo com fonte verificada

## Resultado
- **Sete modalidades** associadas à Rede pelo código pessoal único: produtos, revendas, Moto/Carro, profissionais, caronas, Clube, publicidade.
- **Primeiro convite autenticado** fica imutável no banco após validação de código, proprietário, identidade permanente, não autoindicação e janela de 30 dias da criação da conta. Link em navegador é pista de atribuição, não recibo ou autorização para crédito.
- **Conquistas de módulos** contadas exclusivamente a partir das fontes servidoras: primeira compra com indicação e pedido liquidado; empresa aprovada; taxa de mobilidade realmente paga; anúncio profissional/caronas publicado; pacote de Clube com líquido comprovado e sem estorno; publicidade paga com receita líquida verificada, sem reembolso.
- **Rede mostra** contas vinculadas, conversões por modalidade e uma ressalva clara que contatos/cliques/cadastros não geram dinheiro. Só o titular vê suas métricas; UI limpa estado após troca de sessão.
- **Publicidade** ganha trilha de bonificação direta de **até 5% da receita líquida real da primeira campanha confirmada** do novo anunciante, sem sobrepor fundo de 10% dos pacotes de redução de taxas. Registro apenas após prazo mínimo de 7 dias, aceite de termos, confirmação de comprovante NET e ausência de estorno. A reversão invalida a bonificação. Tabela privada e sem saques.
- **Política Ads começa DESATIVADA**, com activation somente pelo superadmin com referência real de termos aceitos; não aprovar automaticamente termos legais nem conceder crédito retroativo de campanhas existentes.
- Nenhuma transação Pix, bônus em carteira ou saque foi executado; o motor de saque manual do programa existente permanece independente.

## Separação comercial rigorosa
1. **Conquista verificada** é métrica de engajamento. Não é moeda, milha, cashback, direito a desconto ou promessa de resgate.
2. **Bônus direto de publicidade** é novo custo de aquisição limitado (até 5% NET), contabilizado separadamente e indisponível para saque até autorização futura, após revisão jurídica e conexão segura com os saques manuais.
3. **Fundo 10%** continua restrito a pacotes de redução de tarifas de revenda e Moto/Carro, desligado até termos específicos, sem redistribuir vendas de mercadorias ou compromissos do Clube.
4. **Caronas gratuitas** não geram dívidas financeiras e hospedagens permanecem suspensas.
5. Fase posterior: conectar bonificação validada de publicidade ao resgate somente após teste de conservação e reversão; estender novas bonificações a modalidades que passarem a cobrar receita própria reconciliada, não faturamento de terceiros.

## Evidências e segurança
- `tests/network-cross-module-benefits-v1-1041.mjs` no Audit.
- `tests/sql/network-cross-module-benefits-v1-1041.sql` no fluxo de PostgreSQL **descartável**, `ROLLBACK`.
- Todas as tabelas novas `public`: RLS habilitado, sem privilégios diretos para `anon` ou `authenticated`; RPCs de definição de direitos e escrita só `service_role` via Edge autenticado.
- As consultas e bonificações não possuem endpoint público de escrita de dinheiro, e só incluem fatos da plataforma já verificados.
