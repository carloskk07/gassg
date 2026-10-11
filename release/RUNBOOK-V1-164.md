# TAMÃO — Integração V1.164: revisão consolidada e plano de publicação

**Estado: CANDIDATA DE REVISÃO. NÃO AUTORIZA PUBLICAÇÃO.**

Esta branch reúne as dez PRs encadeadas #205, #207, #208, #209,
#210, #211, #212, #213, #214 e #215 sem reescrever seu histórico. A PR
de integração tem **base `main`** para executar o conjunto completo de
testes como será incorporado. As PRs originais permanecem abertas.

## Diagnóstico verificado em 11/10/2026

- `main`: `9ee0547aaaf2ac8b1ca742dab16984f025ca3548`.
- `main` ainda não contém as quatro migrações de 11/10.
- No projeto Supabase de produção foram consultados **0 revendas, 0 pedidos,
  `commerce_enabled=false` e `operation_mode=PRELAUNCH`**. Esse estado
  não é justificativa para simular compras públicas.
- O GitHub Pages é fallback manual. Os domínios e origens oficiais são
  `tamao.com.br`, `parceiro.tamao.com.br` e `admin.tamao.com.br`.
  A conexão de CI/CD do Cloudflare Pages precisa ser verificada no painel,
  pois um merge em `main` pode iniciar um deploy automaticamente.
- Sem identidade e documentação da primeira revenda real ou prova definitiva
  das suas autorizações nesta rodada. Não há transação de pagamento real
  homologada pelo conjunto de testes sintéticos.

## Dependências antes do primeiro merge em `main`

1. **Banco:** revisar e programar a aplicação das migrations
   `20261011043000`, `20261011063000`, `20261011073000` e
   `20261011083000` **nesta ordem**, com backup, janela de implantação,
   plano de recuperação e prova real no banco. Os E2E em
   `BEGIN; ...; ROLLBACK;` são testes, não aplicações permanentes.
2. **Funções:** revisar e implantar versões compatíveis das Edge Functions
   `admin-ops`, `create-order`, `get-offers`, `get-order` e
   `order-payment-checkout`. Revisar permissões, CORS, service_role,
   antiabuso, privacidade e regras de dinheiro para a revenda.
3. **Identidade comercial:** CNPJ conferido e proprietário autorizado
   confirmado por documentação real, separadamente do cadastro da revenda.
   Para GLP, também conferir a autorização ANP vigente. Não certificar
   por cadastro sintético, fotografia ou autodeclaração.
4. **Recebimento e entrega:** teste documentado de uma venda real com
   pagamento direto à revenda (dinheiro/Pix/maquininha própria e PSP homologado
   quando aplicável), aceite, saída, PIN, liquidação e conciliação da taxa
   TAMÃO sem custódia de recursos de terceiros.
5. **Portais:** confirmar domínio/HTTPS e `portal-build.json` com **mesmo
   commit fonte** nas três origens. Usar OIDC do workflow de prontidão em
   produção; não confiar num link preview aleatório ou captura isolada.
6. **Operação:** conferir se a cidade aparece habilitada somente ao existir
   revenda elegível, com oferta realmente disponível por CEP e produto;
   verificar suporte, cancelamento, reprecificação, aviso WhatsApp com
   consentimento e gestão de prospecção ANP.
7. **Autorização:** após completar os itens anteriores, registrar o
   responsável pela decisão comercial e sua aprovação. **Não habilitar
   `commerce_enabled` automaticamente por merge ou build.**

## Como revisar sem publicar

- Abrir a PR integrada para `main`. A auditoria normal verifica o conjunto.
- Abrir o workflow `TAMÃO release-candidate visual review (no deploy)`
  e baixar o artefato `tamao-v1-164-visual-review`. As imagens são geradas
  por um servidor HTTP local dentro do GitHub Actions, sem domínio público e
  sem acessar cadastro de clientes reais.
- Conferir home (320, 390, 1440 px), Como funciona, landing de revenda,
  pedido e acompanhamento (390 px). Os prints são evidências de interface,
  **não provas de pedidos, fluxos autenticados ou entrega real**.
- A verificação `scripts/release-integration-preflight.mjs` passa para
  revisão estática, mas intencionalmente falha com `--production` enquanto
  faltam as evidências independentes listadas.
- Usar o relatório de testes de integração sem criar dados de negócio em
  produção. Manter a operação pública bloqueada.

## Ordem sugerida quando houver homologação real

Aplicar migrations de forma controlada → implantar Edge Functions compatíveis
→ provar RLS/CORS/idempotência e rotas por CEP → publicar os três bundles na
mesma SHA com validação por OIDC → testar jornada completa real com suporte
→ autorizar operação na cidade elegível.

**Não inverter a ordem:** implantar o frontend que exige a API nova
antes das migrations e funções pode quebrar o cadastro de parceiros e o
checkout. A simples inclusão na `main` pode disparar Cloudflare Pages
e upload automático de bundles; por isso a PR consolidada fica em rascunho.

## Recuperação

Manter `commerce_enabled=false` como barreira comercial ao surgir erro
crítico. Reimplantar os bundles anteriores, com invalidação de service
worker/cache por SHA, se necessário. Não executar `DROP TABLE`, reversões
financeiras manuais ou rollback destrutivo de migração numa base que já
recebeu transações; usar correção aditiva verificada em transação.

**Critério final de aprovação:** experiência visual aprovada, conjunto completo
de testes verde, migrações e funções provadas, portais na mesma SHA,
documentação de revenda/ANP verificada, pagamento direto e entrega real
homologados e liberação comercial explícita pelo administrador.
