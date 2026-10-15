# TAMÃO V1.300 — Nova experiência completa (fase de fundação)

## Missão
Fazer do TAMÃO um produto fácil de entender e usar em três jornadas: **comprar**, **vender** e **participar da rede**, com controles críticos na administração. O objetivo de alto CTR é conversão **útil** e **verificável** (consulta por CEP, pedido real, cadastro válido, envio consentido de indicação), não clickbait ou promessas de renda.

## Publicação V1.300
1. Padrão visual global dos três portais: paleta coesa, hierarquia tipográfica, superfície, estados, botões, foco acessível, espaçamento, responsividade e animações reduzidas.
2. Home: três caminhos inequívocos, consulta por CEP como ação principal, valor de venda para revendas e participação na rede com benefícios condicionados às regras. Nunca apresenta estoque, renda, entrega ou preço não comprovado como fato.
3. Área da revenda: barra clara de situação, quatro atalhos principais, pedidos sempre visíveis e prioridade operacional. Início guiado abre por padrão se a revenda ainda não puder ficar online; crescimento, resultados e configurações agrupados em seções expansíveis.
4. Administração: **Central de decisões e liberações** com atalhos para as autoridades operacionais existentes: revendas, cidades, habilitações, catálogo, finanças (apenas papel autorizado), sistemas e incidentes. Não cria controles de habilitação falsos, nem substitui verificações do backend.
5. Sem migrações de banco, transações fictícias, notificações automáticas ou alterações em taxas/política financeira.

## Matriz de responsabilidades — arquitetura-alvo
- **Cliente**: consultar oferta real por CEP; comprar, acompanhar, indicar voluntariamente e usar benefícios elegíveis. Sem autorização para mudar regras centrais.
- **Revenda**: administrar preços, estoque, entrega, equipe e disponibilidade do dia **dentro de sua habilitação e elegibilidade**; nunca aprovar a própria empresa nem criar privilégios de plataforma.
- **Administrador principal**: controlar critérios e decisões estratégicas (abertura/pausa de cidade, habilitação de revenda, módulos, campanhas, PSPs, taxas, regras de benefício e liberações sensíveis) por processos auditáveis. Delegação, se houver, deve ser explícita por papel; nunca acesso genérico por estar autenticado.
- **Servidor**: garante RLS/ACL, estados financeiros comprovados, validação comercial, limites, idempotência, trilha de auditoria e bloqueio de recursos críticos. Uma tela não constitui autorização.

## Continuação vinculada a verificações reais
- **V1.301 — jornadas públicas / CRO:** análise do funil com consentimento e instrumentos mensuráveis, melhorias das páginas de empresas, marcas, benefícios e cidade; testes A/B sem inventar depoimentos ou escassez.
- **V1.302 — cliente e recompra:** pesquisa de oferta, escolha, checkout, histórico, rede e benefícios com telas progressivas e estados vazios objetivos.
- **V1.303 — revenda:** onboarding progressivo com foco em operação real, revisão de cada bloco, catálogo, pedidos e entrega na mão.
- **V1.304 — central de autorizações:** auditoria de todos os caminhos de ativação no banco/Edge, inventário de flags e permissões, implementação de gates administrativos efetivos onde ainda não existirem, sem quebrar operação já legítima nem criar bypass de segurança.
- **V1.305 — validação de campo:** mobile Android/iOS, lentidão e offline, acessibilidade WCAG, testes de pedidos e retornos, tempo para a primeira operação, taxa de abandono e estabilidade.

## Critérios de aceite da transformação
Visita: pessoa entende em até uma dobra o que o TAMÃO faz e como consultar seu CEP.
Cliente: consegue consultar disponibilidade, visualizar preço/prazo e concluir somente um pedido elegível.
Revenda: vê o próximo passo real e os pedidos importantes acima de campanhas e configurações.
Admin: encontra a área responsável pela liberação, com autorização server-side e auditoria; nenhuma flag sensível é criada apenas em HTML.

**Não declarar pronto para operação universal por ter redesign:** a abertura de cidades e o envio de alertas automáticos ainda exigem evidências e liberações verificadas. 
