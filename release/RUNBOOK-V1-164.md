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

## Checkpoint obrigatório do plano Free

O Supabase deste projeto está no plano **Free**. Conforme a documentação
oficial, os backups diários gerenciados são oferecidos nos planos Pro,
Team e Enterprise; projetos Free precisam exportar seus próprios backups.
**Não executar DDL persistente sem um checkpoint recuperável.**

O script versionado `scripts/release-db-backup-checkpoint.sh` usa
`pg_dump` em formato customizado, `pg_restore --list` e checksum
SHA-256. O arquivo permanece **fora do repositório** com permissões
restritas e não deve ser enviado para GitHub, Slack, chat ou log de CI.

Fluxo de preparação, em um ambiente seguro com utilitários PostgreSQL
instalados e credenciais libpq `PGHOST/PGDATABASE/PGUSER/PGPASSWORD`
definidas fora do histórico do shell:

```bash
TAMAO_BACKUP_DIR=/caminho/seguro/fora/do/repositorio \
  bash scripts/release-db-backup-checkpoint.sh --preflight
TAMAO_BACKUP_DIR=/caminho/seguro/fora/do/repositorio \
  bash scripts/release-db-backup-checkpoint.sh
```

**O preflight não cria backup.** Uma execução sem `--preflight`
salva o dump apenas se a conexão PostgreSQL funcionar. Antes de migrar,
restaurar uma cópia em banco **isolado**, conferir objetos/dados e guardar
o checksum. O simples `pg_restore --list` não prova restauração
bem-sucedida.

Outro bloqueio: a tabela `supabase_migrations.schema_migrations` deve
corresponder **exatamente** aos prefixos de 14 dígitos e nomes dos
arquivos no repositório. `scripts/release-migration-history.mjs`
compara um snapshot JSON somente leitura das migrations; status
`NOT_APPLIED` exige implantação e `DRIFT_BLOCKED` proíbe promoção.
Não cadastrar versões arbitrárias com timestamp diferente apenas para
satisfazer a ferramenta. Não inserir registros artificiais no histórico.

Esses checkpoints protegem a publicação. Nunca imprimir senhas ou
`service_role` no relatório e não colocar cópia de dados reais em
artefatos públicos. Os E2E com `BEGIN/ROLLBACK` existentes continuam
importantes, mas **não substituem backup e restauração**.

## Dois marcos separados — divulgação e operação real

### Marco A: publicar site informativo e captar interessados (com vendas bloqueadas)

**Não é necessário já ter concluído uma venda real para divulgar o TAMÃO,
receber interesse de revendas ou avisar usuários de novas cidades.**

Antes da publicação integrada desta versão:

1. Aplicar controladamente as quatro migrations compatíveis
   (`20261011043000`, `20261011063000`, `20261011073000`,
   `20261011083000`) nesta ordem, com backup, janela de implantação
   e validação pós-aplicação. Os testes `BEGIN ... ROLLBACK` não instalam schema.
2. Implantar as cinco Edge Functions correspondentes e comprovar RLS,
   autorizações, CORS, idempotência e compatibilidade do novo frontend.
3. Confirmar `commerce_enabled=false`, impedir checkout operacional até
   liberação global e manter a captura de interesse consentida por cidade/CEP.
4. Verificar cópia pública, preços reais ou identificados como referência,
   ausência de revendas falsas, desempenho mobile e rota de retirada do
   consentimento para avisos.
5. Revisar deploy automático do Cloudflare na `main`, preservar versão
   anterior recuperável e atestar HTTPS + `portal-build.json` da **mesma SHA**
   nos domínios cliente, revenda e admin. OIDC de prontidão verifica esses
   portais depois do deploy, não antes.
6. Registrar a aprovação de publicação institucional, distinta da liberação
   de pedidos reais.

### Marco B: habilitar primeira cidade a receber pedidos reais

Uma cidade pode abrir automaticamente após o cadastro e a homologação de
**uma revenda realmente elegível**, desde que a plataforma já esteja
autorizada globalmente a operar. Requisitos:

1. CNPJ ativo e prova documental do representante autorizado da revenda.
2. Para GLP, autorização ANP vigente e obrigações específicas do produto;
   para água, carvão e outros produtos, cumprir os respectivos controles,
   sem exigir ANP indevidamente.
3. Capacidade verdadeira de atendimento do CEP, preço, estoque, área
   de entrega e método de pagamento direto à própria revenda homologado.
4. Aceite/entrega/PIN/reprecificação/cancelamento e conciliação da taxa TAMÃO
   funcionais e comprovados no ambiente apropriado.
5. Autorização **global** de comércio concedida pelo administrador. Não
   exigir autorização manual cidade a cidade quando houver elegibilidade
   efetiva; manter bloqueio individual se perder CNPJ, ANP, representação
   ou capacidade de entrega.

O **primeiro pedido real completo** é uma verificação pós-abertura,
não pré-condição circular para habilitar a primeira cidade. Monitorar
aceite, pagamento direto, entrega, PIN, taxa e incidentes, e suspender
somente a região inadequada quando possível.

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

## Ordem de publicação

**Site institucional:** migrations validadas e aplicadas → Edge Functions
compatíveis → contratos de segurança → bundles dos três portais na mesma
SHA → prova remota OIDC → coleta de leads e cadastro, sem pedidos reais.

**Comércio por município:** primeira revenda jurídica e operacionalmente
elegível + liberação global de comércio → abertura automática daquele
município e somente seus CEPs/produtos elegíveis → monitoramento do
primeiro pedido real e da liquidação direta à revenda.

Não inverter frontend e backend. Um merge em `main` pode iniciar publicação
automática Cloudflare; portanto a PR integrada permanece em rascunho até
concluir o Marco A.

## Recuperação

Manter `commerce_enabled=false` como barreira comercial ao surgir erro
crítico. Reimplantar os bundles anteriores, com invalidação de service
worker/cache por SHA, se necessário. Não executar `DROP TABLE`, reversões
financeiras manuais ou rollback destrutivo de migração numa base que já
recebeu transações; usar correção aditiva verificada em transação.

**Critério para publicar páginas públicas:** experiência visual aprovada,
auditoria verde, banco e funções compatíveis e aplicados, três portais na
mesma SHA, captação com consentimento e comércio ainda desabilitado.

**Critério adicional para vender por cidade:** revenda/representante
homologados, ANP somente se GLP, rota de pagamento à revenda validada,
oferta real por CEP, fluxo operacional íntegro e liberação global
administrativa. A primeira venda é acompanhada após a abertura.
