# TAMÃO V1.321 — Início guiado de publicidade para cada revenda

## Problema comprovado
Na consulta ao banco antes da implementação, o funil de publicidade estava vazio: **0 criativos aprovados, 0 planos prontos para contato, 0 ofertas com interesse registrado e 0 checkouts**. Não é um problema que se resolva adicionando controles de pagamento: primeiro precisamos permitir que as revendas iniciem propostas comerciais reais de forma clara.

## Evolução implementada
No portal da revenda, em **Vender mais e ampliar sua rede → Coloque sua revenda no caminho de novos clientes**, o titular e o gerente podem consultar no servidor os pré-requisitos reais para **enviar uma proposta de campanha**:
- Revenda com status `active`.
- Cidade/UF preenchidas no cadastro empresarial.
- Interesse registrado na pesquisa de divulgação TAMÃO Ads.
- Pelo menos um produto ativo com perfil de entrega ativo na categoria escolhida.
- Cidade/UF da peça iguais à cidade atual do cadastro.
- Proposta comercial em `draft` para submissão; propostas já enviadas/aprovadas permanecem em seus estados próprios.

A nova RPC `merchant_ads_start_read_v1_321(actor,merchant)` é **somente leitura**, protegida por acesso `service_role`, busca sempre a revenda explicitamente autorizada no banco e retorna dados agregados e um próximo passo codificado. Nenhuma alteração financeira ou comercial é realizada pela consulta.

## Experiência
- Painel apresenta a condição atual de cada etapa e **um próximo passo objetivo**, com navegação para interesse, peça ou configuração.
- Exemplo opcional de título/descrição para facilitar o primeiro rascunho, **sem salvar nem enviar automaticamente**. A revenda pode revisar, personalizar e então usar os controles de proposta V1.233 que já existem.
- Ao salvar interesse ou atualizar uma campanha, a checagem é invalidada para evitar mostrar progressos antigos.
- Na aprovação do criativo, o guia confirma apenas que a peça passou em revisão; não sugere impressões ou vendas inexistentes.

## Segurança e limites
- A RPC usa `SECURITY DEFINER` com `search_path` fixo e valida membro ativo owner/manager independente do JWT do Edge; `anon` e `authenticated` não têm `EXECUTE`.
- Edge `merchant-ops` exige identidade autenticada, escopo da revenda, valores tipados e consistência de `readyToSubmit`.
- **Não há criação automática de interesse, criatividade, aprovações, contratos, checkouts, anúncios públicos, abertura de cidades, notas, pagamentos ou receita.**
- Sem mensagens de marketing não solicitadas e sem simulação de adoção. O teste de regressão utiliza cenários locais, não cria empresas falsas em produção.
- O guia só afirma ser `readyToSubmit` se todas as condições atuais da ação `submit` em V1.233 estão presentes; a função original continua sendo responsável por validar no momento do envio.
- Não há alterações no mecanismo de ranking orgânico ou em pagamentos das revendas.

## Arquivos
- `supabase/migrations/20261016150000_ads_merchant_guided_start_v1_321.sql`
- `supabase/functions/merchant-ops/index.ts`
- `js/merchant.js`, `css/components.css`
- `tests/ads-guided-start-v1-321.mjs`
