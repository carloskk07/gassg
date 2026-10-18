# TAMÃO — Expansão integrada de descoberta e anúncios

**Iniciativa canônica:** `feat/unified-discovery-tamao`. Uma única PR
consolidada para Profissionais, Caronas, Hospedagens, descoberta e publicidade.
Não confundir commits desta branch com funcionalidades publicadas.

## Evidência inicial (18/10/2026)

- `main`: `433101839489f7739f44ddcf04e664ddff3435bd`.
- Supabase conectado: `lgugwujpunhslavewffd`, `ACTIVE_HEALTHY`.
- `platform_launch_control`: `PRELAUNCH`, `commerce_enabled=false`.
- Portais atestados no banco com esse mesmo SHA; consulta pública direta ao
  `portal-build.json` não pôde ser concluída pelo leitor web.
- 154 tabelas em `public`, 422 funções em `public`, 64 tabelas com
  sufixos históricos `_v1_...`. Esse padrão exige auditoria, mas não prova
  por si mesmo instalações duplicadas.
- A estrutura atual não oferece os três domínios funcionais propostos como
  fluxos completos; não há anúncios de hospedagem/carona/profissionais que
  possam legitimamente ser exibidos.
- O marketplace atual **não deve ser ativado** como efeito da expansão.

## Código introduzido nesta PR

`supabase/migrations/20261018131000_discovery_shared_verticals.sql`:
um anúncio-mãe com três tabelas de detalhes (profissional, carona e hospedagem);
autorização por UF/cidade/modalidade; acesso público exclusivamente a anúncios
publicados e em localidades habilitadas; rascunhos vinculados ao dono; contas
permanentes verificadas; revisão obrigatória do superadmin; controles contra
autopublicação; trilha de transições; bloqueio de viagens vencidas; tratamento
de pausa e revisão; modelos financeiros próprios da publicidade, ainda sem
cobrança executável. Caronas ficam fora da tarifa diária.

`tests/discovery-shared-verticals.mjs`: contrato estático de RLS, autoridade
administrativa, contas verificadas, geografia independente e não cobrança.
O CI `Audit` agora verifica esse contrato.

**A migração é código proposto, não aplicado.** Não iniciar migração contra
produção antes de passar no CI, auditar os GRANTs e testar isoladamente transações
com atores anon, autenticado, proprietário A/B e superadmin.

## O que falta para autorização de produção

1. **Anunciante:** cadastro simples e permanente, upload seguro de fotos,
   validação documental por modalidade, meus anúncios, edição, revisão,
   pausas e contatos de teste.
2. **Consumidor:** buscas reais por modalidade, cidade e critérios específicos;
   cards públicos e detalhe em `pt-BR` e `es-AR`; compartilhamento e
   contato internacional sem login obrigatório.
3. **Admin:** telas reais para localidades por modalidade, revisão,
   documentação, denúncias, políticas comerciais e histórico; reutilizar a
   autenticação `superadmin` existente, sem novo painel paralelo.
4. **Monetização:** aceite de termos, período promocional, precificação ativa,
   cobrança idempotente por dia, conciliação com provedor, estorno, inadimplência
   e recibos; nenhuma cobrança de carona ou sobre serviços/hospedagens
   negociados diretamente entre pessoas.
5. **Publicidade:** inventário, criação e duração de impulsos, pagamento
   confirmado, identificação de patrocinados, métricas auditáveis, proteção
   contra resultados inventados. Integrar, não replicar, a infraestrutura Ads.
6. **Reputação:** avaliações com vínculo de experiência comprovável e moderação,
   sem tratar clique como contratação nem vender nota.
7. **SEO Argentina:** HTML de servidor ou prerender com dados públicos reais
   para idioma/destino; canonical, `hreflang=es-AR`, `pt-BR`,
   `x-default`, sitemaps consistentes, ausência de páginas vazias,
   dados estruturados corretos e relatórios Search Console segmentados
   por país. Não inventar imóveis, preços, conversões ou disponibilidade.
8. **Testes:** unidade, RLS real, integração, rotas, acessibilidade e
   browser E2E 360/768/1440; compilação isolada dos três portais;
   verificações de fluxos atuais de revenda, pedido e financeiro.
9. **Ativação:** somente após revisão integrada, snapshot/restore exercitado,
   execução de migrations segura, reconciliação dos três portais por SHA
   e decisão explícita do superadmin para cada vertical/cidade.

## Critérios que impedem o merge ou a ativação

- Falta de fluxo real de cadastro, publicação e busca.
- Dados privados alcançáveis pelo visitante ou um anunciante lendo outro.
- Ativação de produto/serviço por permissão implicitamente herdada de cidade.
- Cobrança sem consentimento, tarifa aprovada e mecanismo de idempotência.
- Páginas espanholas vazias, duplicadas ou feitas para manipular buscadores.
- Incapacidade de testar recuperação e regredir sem interromper compras.
- Ausência de evidência objetiva da publicação dos três `portal-build.json`.

## Arquitetura-alvo

**Fonte compartilhada:** `discovery_listings` (dono, estado, idioma do
visitante em apresentação, cidade, mídia, ciclo de vida). **Detalhes por
vertical:** tabelas profissionais, caronas e hospedagens. **Habilitação:**
`discovery_vertical_cities` por modalidade, não `market_cities.commerce_enabled`.
**Financeiro:** somente publicidade; ledger diário exclusivo da plataforma,
sem empréstimo do recebimento de pedidos de clientes. **Dados pessoais:**
somente informação comercial de contato e área aproximada em páginas públicas,
documentos sensíveis em armazenamento privado a definir.

Todas as interfaces devem usar uma única biblioteca de componentes e a
arquitetura de scripts/builds existentes. Não criar home paralela,
microfrontend duplicado ou páginas de resultado sem inventário. Os arquivos
desta iniciativa permanecem uma proposta até a entrega consolidada.
