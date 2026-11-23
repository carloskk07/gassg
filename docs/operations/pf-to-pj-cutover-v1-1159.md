# TAMÃO — plano operacional de migração PF → PJ (V1.1159)

**Estado inicial:** o TAMÃO continua operando com a configuração financeira atual. **Nenhum CNPJ foi informado, criado ou aprovado por esta implementação.** A partir da V1.1160, o caminho principal é **Admin → Financeiro → Empresa / CNPJ** (exclusivo do superadministrador); o atalho anterior da Rede é preservado. O painel prepara a futura troca e exige verificações documentais reais antes da virada.

**Referências públicas oficiais (consultadas em 22/11/2026):**
- [REDESIM / inscrição no CNPJ](https://www.gov.br/pt-br/servicos/inscrever-no-cnpj) — viabilidade, registro, regime e licenças.
- [CNPJ alfanumérico](https://www.gov.br/receitafederal/pt-br/acesso-a-informacao/acoes-e-programas/programas-e-atividades/cnpj-alfanumerico/cnpj-alfa) — desde julho de 2026, o novo formato aceita 12 caracteres alfanuméricos e dois verificadores numéricos. CNPJ antigo permanece válido.
- [Emissão de NFS-e](https://www.gov.br/pt-br/servicos/emitir-nota-fiscal-de-servico-eletronica) — sujeito à atividade, inscrição e obrigação fiscal.
- [Mercado Pago — como migrar CPF → CNPJ](https://www.mercadopago.com.br/blog/beneficios-de-ter-cnpj-e-como-mudar-sua-titularidade-no-mercado-pago) — a troca de titularidade cadastral e a habilitação da conta empresa acontecem **no provedor**, não ao digitar CNPJ no TAMÃO.

## O que já está preparado tecnicamente

1. **Cadastro PJ isolado**: razão social, nome fantasia, CNPJ de 14 posições (numérico ou alfanumérico), endereço público e e-mail comercial. Banco privado; sem publicar rascunhos e sem armazenar CPF, selfie ou documento original.
2. **Estado atual PF preservado** até a virada formal. A função `platform_operator_public_identity_v1_1159()` só devolve dados PJ após ativação explícita. Termos de Uso consumirão essa identidade pública via DOM seguro.
3. **12 comprovações versionadas**, somente pelo superadmin, cada uma com referência de documento/processo REAL. Alterar dados do cadastro invalida todas as comprovações anteriores.
4. **Conferência de concorrência** por revisão da ficha, trilha de auditoria imutável para ações administrativas e permissões de serviço (tabelas com RLS e sem escrita por navegadores).
5. **Ativação definitiva** exige 12/12 comprovações, CNPJ válido, confirmação digitada e inexistência de solicitações de saques manuais em estado aberto. Não altera segredos, configuração da conta bancária, histórico de transações, saldo ou beneficiários.
6. **Recursos antigos continuam preservados** no mesmo banco e nos mesmos IDs. Nenhuma remarcação retroativa de pagamentos, comissões, cupons, repasses ou créditos como se pertencessem ao CNPJ novo.

## Passos quando o CNPJ realmente existir

1. Formalizar a empresa com apoio contábil, selecionar estrutura jurídica, CNAEs e regime tributário adequados ao TAMÃO (marketplace, publicidade, agendamento, taxas de plataforma). **Não presumir enquadramento MEI**.
2. Inscrever-se na prefeitura/SEFAZ conforme a atividade; confirmar licenças e os emissores fiscais aplicáveis. Consultar contador sobre retenções, documentos e eventual ISS/ICMS.
3. Abrir ou migrar o perfil **Mercado Pago Negócio PJ** pelo fluxo oficial da plataforma. O CNPJ do perfil deverá coincidir com o emitente de cobranças/recebíveis; o TAMÃO NÃO faz essa alteração automaticamente.
4. Planejar janela curta de virada: evitar novas cobranças enquanto houver troca de token, configurar **novas credenciais só em secrets do Supabase/Cloudflare**, conciliar cobranças PF antigas, revalidar os webhooks, assinaturas e credenciais da PJ. **Nunca copiar access token ou segredo em formulário, GitHub ou SQL.**
5. Validar com pagamentos reais de valor conhecido a emissão, QR Code Pix, webhook, conferência automática, estorno, reconciliação e extrato dos três portais. Usar processo de homologação financeira com controle de valores e confirmação independente.
6. Separar **receitas e obrigações PF anteriores** do período PJ posterior à virada. Não migrar IDs de pagamentos e não reatribuir documentos fiscais já emitidos. Conferir publicidade, pacote de redução de taxas, comissões recorrentes, fundo de 10%, Clube, cashback, pedidos, devoluções, contestação e saques manuais ainda devidos.
7. Atualizar contratos, política de privacidade, regulamentos, identificação pública, atendimento, dados de faturamento, notas fiscais e instrumentos contratuais das revendas. Se houver alteração material da contraparte, planejar comunicação e os aceites necessários — não inventar consentimentos.
8. No **Admin → Financeiro → Empresa / CNPJ → Preparar migração para CNPJ**, registrar o CNPJ e dados reais. Marcar uma das 12 verificações apenas após conferir fonte externa e informar referência verificável com data; o histórico fica no banco. Reabrir um item se a comprovação for invalidada.
9. Somente com **12/12**, realizar confirmação explícita de ativação PJ. O TAMÃO passará então a exibir a razão social, CNPJ e endereço da empresa nos Termos de Uso. Conferir a URL oficial e a identidade com o registro da Receita.
10. Conferir a operação nas primeiras cobranças PJ, reconciliações e estornos. Em caso de divergência após a virada, **pausar novas cobranças**, manter o ledger e abrir incidente com correção auditada. A versão V1.1159 não oferece troca automática de volta para CPF, para não misturar a titularidade histórica.

## O que não se deve fazer agora

- Não ativar a empresa com CNPJ de exemplo ou registro que não exista.
- Não preencher 12 provas fictícias, nem assumir que marcação no Admin é validação oficial.
- Não usar a conta PF ou as credenciais Pix PF como se fossem de um CNPJ recém-criado.
- Não transferir custódia de saldos entre CPF/CNPJ pela troca do cadastro.
- Não excluir histórico fiscal, solicitações de reembolso, estornos, contestação, reservas ou aceites anteriores.
- Não marcar pagamentos como realizados sem comprovante externo.

## Trilhas de teste e governança

- `tests/operator-cnpj-transition-v1-1159.mjs` — DV numérico e alfanumérico, controle de ações, isolamento PJ, fronteiras de build e privacidade.
- `tests/sql/operator-cnpj-transition-v1-1159.sql` — rejeição de CNPJ inválido, bloqueio do público ao cadastro privativo e proibição de ação sem superadmin.
- Migração: `supabase/migrations/20261123040000_platform_operator_cnpj_transition_v1_1159.sql`.
- Endpoint restrito: `operator-transition-ops` (não relacionado ao executor de transferências Pix).
- Dados públicos: Edge `operator-public-identity` consulta `platform_operator_public_identity_v1_1159()` **somente no servidor** e retorna apenas a PJ efetivamente ativada, jamais o rascunho. A RPC privilegiada NÃO é executável por `anon` ou `authenticated`.

> Esta preparação é técnica e operacional. O registro do CNPJ, autorização fiscal, contratos, verificação cadastral do PSP e eventual revisão jurídica exigem atos reais quando a empresa existir.

## Ajuste V1.1160 — acesso simples sem dependência da Rede

- A preparação PJ passa a ter espaço próprio e visível no menu principal do Financeiro, sem carregar o módulo de saques ou iniciar operações financeiras.
- Ao abrir a área, a interface lê o estado real do banco. Somente o superadministrador pode consultar ou editar o preparo; perfis de finanças, operações e suporte não recebem acesso.
- Os cinco dados da futura empresa digitados e ainda não salvos permanecem em memória durante novas renderizações do painel. Ao trocar de conta ou perder a permissão de superadmin, o rascunho em memória é descartado. Não se usa `localStorage`, `sessionStorage` nem pagamento simulado.
- Na futura formalização, o primeiro passo continua sendo apresentar um CNPJ e a documentação oficial válidos; V1.1160 não cria nem ativa uma empresa antecipadamente.

## V1.1161 — conferência financeira automática antes da virada

O Admin exibe sete contagens **reais, somente de leitura**: saques manuais em aberto, repasses Pix com resultado não definitivo, reservas/revisões da Rede, estornos Ads em análise, estornos do Clube em solicitação/revisão, estornos da Agenda não confirmados e estornos de revendas requerendo revisão. As contagens são observadas diretamente no Supabase e não alteram dados financeiros nem emitem novo Pix.

Se uma dessas sete contagens for diferente de zero, o botão de ativação PJ fica bloqueado e o PostgreSQL rejeita a ativação mesmo que alguém envie uma requisição direta ao servidor. Uma tela desatualizada não basta para fazer a virada; o banco reconsulta as filas no ato.

Uma contagem zero **não é** comprovação de quitação geral ou de migração de credenciais do Mercado Pago. Ela só cobre essas sete filas internas. O operador continua responsável por conferir o PSP, cobranças e créditos ainda não liquidados, saldo de caixa, obrigações fiscais, contas bancárias, contratos e demais documentos externos registrados nas 12 verificações. Nenhuma dessas comprovações pode ser marcada automaticamente.

**Evidências técnicas:** `supabase/migrations/20261123120000_platform_operator_financial_preflight_v1_1161.sql`, `tests/operator-cnpj-financial-preflight-v1-1161.mjs` e `tests/sql/operator-cutover-financial-preflight-v1-1161.sql`.
