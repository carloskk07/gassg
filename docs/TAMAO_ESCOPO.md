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
| QA-001 | Engenharia | Testes de unitário, integração, E2E, RLS, falhas de rede, simultaneidade, financeiro, acessibilidade, visual, SEO, desempenho e recuperação |
| REL-001 | Lançamento | Zero P0/P1 conhecidos, migrações e backups conferidos, portais convergentes por SHA, homologação funcional, controles configurados e ativação expressa |

## Fronteiras comerciais e de segurança

O TAMÃO não receberá pagamentos de corridas, caronas, serviços de profissionais nem diárias de hospedagem negociadas entre particulares. Receberá apenas o pagamento de seus próprios produtos de divulgação quando contratados. Caronas ocasionais não são transporte profissional: validar requisitos aplicáveis. Hospedagens devem observar Cadastur e regras locais quando aplicáveis.

Cobrança diária, quando existir, exige aceite informado, período gratuito, evidência de fato gerador, pausa sem novas diárias, uma cobrança por fato e confirmação de pagamento antes do reconhecimento. Não vender selos de qualidade nem publicar avaliações fabricadas.

A autorização para anúncio de profissionais ou hospedagens **não herda** a abertura de cidades para pedidos de gás/água. A publicação de código **não ativa** anúncios ou cobranças. Documentação privada não é entregue a visitantes. Contato internacional deve funcionar sem obrigar o visitante a criar conta.

## Gates antes de publicar

A migração da PR #492 não pode ser aplicada nem a PR integrada apenas por passar em testes estáticos. Cada vertical exige cadastro, envio seguro de imagens, revisão do superadmin, busca/contato real, tratamento de erros, monitoramento e regressão no produto existente. Testar 320/360/390/768/1024/1440 px, restaurabilidade, workflows e três `portal-build.json` com SHAs consistentes.

**Aprovação por modalidade e cidade é separada do deploy.** Falha crítica bloqueia a funcionalidade afetada; jamais liberar parcialmente como se estivesse completa.
