# TAMÃO — Escopo oficial e critérios de aceitação

**Iniciativa única:** Expansão Integrada e Consolidação para Produção  
**Repositório:** `carloskk07/gassg` · **branch:** `feat/unified-discovery-tamao` · **PR:** [#492](https://github.com/carloskk07/gassg/pull/492).  
**Fonte de verdade do andamento:** [TAMAO_EXECUCAO.md](TAMAO_EXECUCAO.md).  
**Decisões de arquitetura:** [TAMAO-EXPANSAO-INTEGRADA.md](TAMAO-EXPANSAO-INTEGRADA.md).

## Produto

TAMÃO — **Precisou? Tá na mão.** Plataforma brasileira de compras, profissionais, caronas, hospedagens, publicidade Impulso, Clube, Rede e administração. O marketplace de produtos, as revendas, cupons, indicações e pagamentos existentes devem ser preservados. Não criar sistema financeiro nem aplicação paralela.

A home deve permitir acessar **Comprar | Profissionais | Caronas | Hospedagens | Clube TAMÃO | Anunciar**, com navegação intuitiva e anúncios reais, jamais simulados como disponíveis.

## Critérios objetivos por domínio

| ID | Requisito | Critério de aceitação |
|---|---|---|
| CONT-001 | Continuidade | Checkpoint versionado com estados, SHAs, testes, bloqueios e próxima ação comprovada; recuperável em nova conversa |
| AUD-001 | Auditoria | Código, duplicações, banco, RLS, auth, infra, SEO, publicidade, finanças, mobile, CI e performance inspecionados, defeitos P0–P3 classificados |
| CORE-001 | Anúncios | Modelo compartilhado, proprietário verificado, detalhes por modalidade, RLS, revisão, estados, cidade independente, busca real e testes contra acesso cruzado |
| PRO-001 | Profissionais | Categorias e habilitações aplicáveis, cadastro, fotos, especialidades, região, horários, promoções, gestão, busca e contato direto |
| RIDE-001 | Caronas | Registro de origem, destino, data, horário, vagas, paradas e despesas; busca, contato, expiração, encerramento e possibilidade de pedidos de carona; básico gratuito |
| STAY-001 | Hospedagens | Cadastro nacional de hotéis, pousadas e imóveis; fotos, capacidade, comodidades, datas declaradas, preço informado, regras, destino, filtros e contato direto |
| UI-001 | UX/UI | Jornadas úteis, formulários curtos, mobile-first, acessíveis, navegação clara nos três portais, nenhum botão fictício |
| SEO-001 | SEO internacional | Português brasileiro e espanhol argentino; URLs úteis e rastreáveis, canonical, hreflang recíproco, sitemaps, dados estruturados elegíveis e métricas por país |
| ADS-001 | Impulso | Campanhas com duração, orçamento, segmentação, patrocinados identificados, medição real e autorização administrativa |
| FIN-001 | Receita de anúncios | Trial, diária contratada e configurável por localidade, fuso definido, idempotência, pausa sem cobrança, conciliação, recibos e inadimplência |
| REP-001 | Reputação | Avaliações ligadas a experiências autênticas, verificação, resolução de denúncias, antifraude e ranking orgânico separado do pago |
| ADMIN-001 | Governança | Superadmin atual governa abertura/cidade, revisão, documentos, tarifa, promoções, ads, moderação, auditoria e financeiro sem segundo aprovador artificial |
| QA-001 | Engenharia | Testes automatizados de regressão, RLS, autenticação, segurança financeira, recuperação e disponibilidade antes das ativações; ampliar E2E, acessibilidade, visual e experiência em uso real durante lançamento assistido, com registro de evidências |
| REL-001 | Lançamento | Abertura assistida progressiva com zero P0/P1 conhecidos, migrações/backup e rollback, portais por SHA, teste mínimo de jornadas críticas, observabilidade, suporte e autorização por modalidade/cidade; homologação de comportamento ampliada em operação real |

## Fronteiras comerciais e de segurança

O TAMÃO não receberá pagamentos de corridas, caronas, serviços de profissionais nem diárias de hospedagem negociadas entre particulares. Receberá apenas o pagamento de seus próprios produtos de divulgação quando contratados. Caronas ocasionais não são transporte profissional: validar requisitos aplicáveis. Hospedagens devem observar Cadastur e regras locais quando aplicáveis.

Cobrança diária, quando existir, exige aceite informado, período gratuito, evidência de fato gerador, pausa sem novas diárias, uma cobrança por fato e confirmação de pagamento antes do reconhecimento. Não vender selos de qualidade nem publicar avaliações fabricadas.

A autorização para anúncio de profissionais ou hospedagens **não herda** a abertura de cidades para pedidos de gás/água. A publicação de código **não ativa** anúncios ou cobranças. Documentação privada não é entregue a visitantes. Contato internacional deve funcionar sem obrigar o visitante a criar conta.

## Regra obrigatória de conclusão operacional — 22/10/2026

**Decisão do proprietário (obrigatória para TODAS as modalidades, inclusive as já implementadas):** nenhuma funcionalidade será considerada **CONCLUÍDA** por existir código, tela pública, migração, teste unitário aprovado, PR integrada, deploy com HTTP 200 ou integração aparentemente configurada. É necessário comprovar **da ação inicial do usuário até o resultado final esperado** com evidências observáveis e registradas.

### Estados diferentes, sem promover automaticamente

- **EM IMPLEMENTAÇÃO:** existem atividades de engenharia pendentes.
- **IMPLEMENTADA:** código e interface disponíveis; não implica integração, disponibilidade pública ou operação útil.
- **EM VALIDAÇÃO:** testes automatizados e/ou de integração em andamento; qualquer lacuna impede dizer concluída.
- **PILOTO CONTROLADO:** exposição limitada e expressamente autorizada, com portão mínimo de segurança da seção seguinte, correção de incidentes, canal de suporte e capacidade de pausa; **não equivale** a concluída.
- **CONCLUÍDA:** todos os critérios objetivos do ciclo integral foram comprovados e registrados, sem falha crítica aberta.
- **BLOQUEADA:** existe impedimento P0/P1, financeiro, de segurança, operacional ou ausência de evidência obrigatória. Código pronto pode permanecer bloqueado.

**Proibição:** não inferir `CONCLUÍDA` a partir de um resultado de CI, do título de PR/versão, do estado de migração, do rótulo de Admin ou de um teste simulado. Nem usar `PILOTO CONTROLADO` para ocultar lacunas ou divulgar ganho/recebimento que não ocorreu.

### Portão de aceitação por funcionalidade

Para avançar a **CONCLUÍDA**, registrar no diário oficial, na seção de gates operacionais (não abrir sistema/documento concorrente):

1. **Ciclo e contrato:** público e responsável autorizados, gatilho inicial real, resultado final mensurável, critérios positivos/negativos e caminho de suspensão/recuperação.
2. **Automação:** resultados dos testes automatizados e regressões relevantes no SHA exato, inclusive erros, duplicidade, concorrência, permissões, privacidade e rollback quando pertinente.
3. **Integração real:** jornada ponta a ponta usando interfaces, autenticação, banco, serviços e provedor efetivamente ligados; testes isolados/mocks devem ser rotulados, não confundidos com integração real.
4. **Implantação:** correlação do SHA aprovado com portal/ambiente efetivamente publicado; teste HTTP/navegador real quando aplicável.
5. **Financeiro (quando aplicável):** origem/titularidade do dinheiro, recebimento confirmado pelo provedor, deduplicação/webhooks, custos/margem, crédito/obrigação, estorno, identificação correta do beneficiário, autorização de saída e liquidação comprovada por evidência independente. Cobranças, Pix, cashback, cupom e comissão não se concluem com aprovação estática.
6. **Evidência auditável:** data, ambiente, autorizações, identificadores não sensíveis ou referências a registros privados no Admin, relatório/testes, critério de êxito, desvios e ausência de P0/P1 conhecidos; nenhuma informação pessoal ou segredo em documentação pública.
7. **Revisão:** registrar confirmação do resultado final, não apenas evento intermediário. Se uma etapa crítica for inconclusiva, permanecer **EM VALIDAÇÃO** ou **BLOQUEADA**.

**Antes de ampliar o escopo**, concluir o ciclo de uma funcionalidade prioritária já existente, corrigindo defeitos na mesma implementação. Reaproveitar o financeiro, os eventos, o painel Admin, o suporte e as migrations atuais; não duplicar páginas, contas, carteiras, ledger, endpoints, tabelas ou versões. Novas modalidades independentes só avançam sem prejudicar a conclusão do núcleo útil.

### Regra de teste versus evidência

O contrato automatizado `tests/tamao-execution-checkpoint.mjs` deve rejeitar registros de conclusão sem todos os campos de prova; **esse teste verifica a presença e consistência dos registros, não autentica o provedor nem substitui o E2E**. A equipe deve conferir a evidência real antes de preencher qualquer campo. Uma integração real impossível de testar ou uma autorização financeira ausente deve ficar explicitamente pendente.

---

## Política de lançamento assistido e homologação em uso real

**Decisão do responsável pelo TAMÃO em 18/10/2026:** priorizar entrada em operação, aprendizado com compradores, revendas e anunciantes reais, e correções rápidas a partir de erros observados e reclamações. Não exigir a conclusão de todos os cenários de homologação, todas as combinações de telas ou a operação de todos os módulos antes de abrir o primeiro uso real controlado. A experiência real complementará os testes, sem representar homologação concluída automaticamente.

**Portão mínimo não negociável para colocar uma funcionalidade nas mãos de pessoas:** CI das alterações aprovado; permissões/RLS e segregação entre contas validadas; jornada essencial de cadastro, publicação e contato funcionando em uma verificação básica; dados sensíveis privados; inexistência de cobrança sem aceite/idempotência; capacidade comprovada de suspender a modalidade e reverter mudanças; recuperação/backups previstos; portal oficial correto e canal funcional de recebimento de reclamações. Defeitos P0/P1 conhecidos impedem ativar a parte afetada. Essa verificação curta deve ser prática e não burocrática.

**Após a abertura:** realizar testes de usabilidade, formulários, idiomas, dispositivos, integrações e comportamento com pessoas reais; coletar reclamações, evidências não sensíveis, métricas e registros de falha; classificar incidentes P0–P3; priorizar por dano real; corrigir na mesma linha de integração, com regressão automatizada antes de cada publicação e conferência pós-deploy. P0: suspender imediatamente a operação afetada; P1: impedir novas ativações e corrigir prioritariamente; P2/P3: corrigir progressivamente sem paralisar as jornadas sadias. Nunca usar dados pessoais de clientes em issues públicas.

**Aprovação por modalidade e cidade permanece separada do deploy:** o administrador principal controla abertura e pausa, sem segunda aprovação artificial. A disponibilização de código não ativa comercialmente cidades nem gera cobrança. As três modalidades podem ter janelas de abertura independentes, sem obrigar concluir todos os módulos ao mesmo tempo.

### Central de acompanhamento nativa (decisão de 18/10/2026)

**Tudo dentro do TAMÃO.** Não adotar Slack, Discord, painéis de suporte paralelos ou dependência de um chat externo para registrar ou resolver reclamações. Reutilizar a **central de incidentes** do painel administrativo e o **atendimento de clientes vinculado aos pedidos** já existentes, sem duplicar estruturas, rotas ou serviços financeiros.

Na evolução do produto, garantir entrada simples de reclamações para compradores, revendas e anunciantes de Profissionais, Caronas e Hospedagens, com identificação da modalidade, referência ao anúncio ou pedido quando aplicável, estado de atendimento, prioridade P0–P3, histórico, resposta e encerramento pelo superadmin/equipe autorizada. Evitar exigir conta apenas para um visitante relatar problema de anúncio público; assegurar proteção antispam e minimizar dados pessoais.

O painel administrativo deve apresentar pendências e alertas derivados de **eventos reais**, sem fabricar métricas, status de saúde ou monitoramento contínuo inexistente. Logs técnicos, falhas de publicação, reclamações e incidentes devem ser correlacionáveis por identificadores seguros, sem expor informações particulares em quadros públicos. Suspensão da modalidade afetada e medidas de recuperação têm prioridade sobre novidades comerciais.

O acompanhamento automático somente poderá ser descrito como **ativo** depois de existir mecanismo efetivamente implantado e testado no TAMÃO (coleta, agendamento, regras de alerta, acesso e recuperação). Quando não houver mecanismo autônomo, o acompanhamento e as correções ocorrem por consulta operacional e novas execuções autorizadas, não por uma promessa de vigilância permanente do assistente.

**Declaração final:** `TAMÃO — PRONTO PARA PRODUÇÃO REAL` somente com a evidência dos critérios mandatórios do projeto. Um piloto ou lançamento assistido é operação real, mas não equivale automaticamente ao selo de conclusão integral.
