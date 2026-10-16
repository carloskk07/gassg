# TAMÃO — Auditoria independente de produção em 16/10/2026

## Escopo verificado (somente leitura, exceto correção específica proposta)
GitHub `carloskk07/gassg` e Supabase `lgugwujpunhslavewffd`. Comparação entre baseline da `main`, CI, controles reais do banco, avisos dos Advisors, permissões PostgreSQL, operações de Edge e lançabilidade comercial. A inspeção não substitui testes transacionais ponta a ponta de todos os fluxos nem análise visual autenticada de todos os portais.

## Achados comprovados
| Área | Evidência de 16/10/2026 | Situação / interpretação |
| --- | --- | --- |
| Banco | 153 tabelas no schema public; nenhuma tabela sem RLS | Defesa de acesso ao navegador preservada. |
| RLS | Security Advisor: 153 avisos informativos `rls_enabled_no_policy` | Políticas ausentes podem ser **intencionais** onde serviço/RPC controla acesso; não adicionar políticas amplas. |
| Funções | 34 Edge Functions em status ACTIVE | `ACTIVE` significa implantada, não sucesso funcional de todas as operações. |
| Controle global | `platform_launch_control`: PRELAUNCH, comércio desligado | Preservado, sem abrir cidade automaticamente. |
| Publicação | Controle de 3 portais OK em SHA `740083d8e2668ae73d8051e7fcb05414c398a738` e CI de deploy/reconciliação bem-sucedida | Evidência automatizada de publicação, não de toda UX em dispositivo físico. |
| Cidades | São Gabriel, RS: `commerce_enabled=false` e `admin_paused=false` | Cidade fechada por ausência de autorização comercial; não é pausa administrativa. |
| Oferta | 1 revenda com `status=pending`, `online=false` | Nenhuma oferta de revenda apta para transação real. |
| Pedidos | 0 pedidos registrados | Não há evidência de fluxo real aceito/concluído. |
| Cobrança revenda | 1 solicitação pendente de R$ 300 (30.000 centavos) | Solicitação não equivale a cobrança concluída, dinheiro recebido ou conciliação. |
| Ads | 0 campanhas de revenda registradas | Receita publicitária não comprovada. |
| Push | 1 inscrição, 0 itens em outbox, 0 entregas registradas | Sem prova atual de alerta visto no dispositivo e do motivo de aviso do Chrome. |
| Performance | 38 FKs sem índice de cobertura; 139 `unused_index` | Segunda categoria é informativa sem tráfego real; não remover índices de imediato. |
| Correção da auditoria | 6 FKs do subsistema push sem cobertura | Migração aditiva, revisão de CI e reavaliação por Advisor. |
| GitHub | V1.328 integrada; falha transitória anterior em teste da central Ativações corrigida na integração | Última auditoria da `main` consultada: sucesso. |

## Priorização de lançamento
**P0 — antes de vender:** identidade, compliance, capacidade de entrega, fornecedor realmente apto, catálogo/preço/estoque confirmados, autorização comercial do superadmin e teste controlado de ponta a ponta para pedido/aceite/entrega, conforme as regras por categoria.

**P0 — financeiro:** comprovar de forma independente o recebimento no PSP, separando plataforma de revenda; testar falha, reembolso/estorno, webhook duplicado, pedido repetido e idempotência sem movimentar dinheiro sem aprovação.

**P1 — notificações:** teste em aparelho real no Chrome e nos navegadores prioritários, incluindo permissão, aviso de possível spam, clique/navegação, atrasos e recuperação de falha. Não marcar como entregue ao usuário só porque o push provider aceitou.

**P1 — experiência:** auditoria visual autenticada no cliente, revenda e admin em 320/360/390 px e desktop; dar atenção a onboarding, compra curta, rotas de suporte, linguagem comercial e estados de erro. Leitura estática e checks de publicação não validam sozinhos essa experiência.

**P2 — performance:** após tráfego real, medir consultas no banco antes de criar outros índices dentre os 32 candidatos remanescentes, e só considerar remoção dos 139 índices pouco utilizados com dados suficientes.

## Limites de comprovação
Não foram realizados pedidos reais, pagamentos, disparos push, ativação de cidades, exclusão de dados, testes com credenciais de usuários reais ou pagamentos de terceiros. Não afirmar 'pronto para vender', 'pagamento homologado', 'push recebido' ou 'UX aprovada' com base apenas em CI ou status das funções.

## Correção versionada nesta PR
`20261016230500_push_fk_index_hygiene_audit.sql` e `tests/push-fk-index-hygiene.mjs`. Após integrar a PR e aplicar a migração, conferir seis índices no PostgreSQL, nova leitura dos Advisors e execução do CI.
