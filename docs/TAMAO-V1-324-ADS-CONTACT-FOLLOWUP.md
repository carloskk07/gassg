# TAMÃO V1.324 — Histórico de orientação comercial solicitado pela revenda

## Contexto
A V1.323 permite ao titular solicitar voluntariamente ajuda comercial com TAMÃO Ads. A V1.324 prepara o acompanhamento **manual** desses pedidos sem inferir contato a partir de interesse, triagem ou fila.

## Admin
No painel **Ativações → Atendimentos comerciais e retornos**, os perfis administrativos autorizados consultam os registros atuais, número de relatos manuais e retornos vencidos. Apenas o `superadmin` pode registrar uma tentativa realmente realizada, escolhendo seu resultado declarado (`not_reached`, `conversation`, `followup_requested`, `not_interested`), nota factual de 20–240 caracteres e, exclusivamente quando houver retorno solicitado, data de 1–30 dias no futuro. O canal acompanha a preferência expressa pela revenda.

O registro usa UUID idempotente, versão atual do pedido de orientação, ator autenticado, horário do servidor e auditoria, protegendo contra repetir o mesmo UUID com conteúdo diferente. O formulário exige confirmação explícita antes de gravar. A consulta de retorno verifica o aumento do número de registros.

## Consentimento e segurança
- A escrita ocorre somente enquanto a revenda estiver **ativa**, com pedido em `requested` ou `triaged`, interesse publicitário ainda afirmativo e canal igual ao escolhido pela revenda.
- A revenda pode retirar o pedido na V1.323, cancelando novos registros. Quando inicia um novo ciclo, contatos anteriores não contam como pendências atuais: o histórico da V1.324 separa as tentativas por horário do pedido.
- Tabela protegida por RLS, com permissões diretas revogadas para `anon` e `authenticated`. Somente `service_role` executa RPCs, que também validam os papéis no PostgreSQL. `operations` e `readonly` leem somente; `superadmin` registra.
- Nenhuma mensagem WhatsApp, e-mail ou ligação é enviada automaticamente. **Relato do administrador não é comprovação independente de entrega ou conversa.**
- Nenhuma cobrança, desconto, contrato, ativação de cidade, anúncio publicado ou receita é criada por esta operação. A versão não apresenta dados comerciais de outras revendas no portal dos comerciantes.
- Testes de regressão impedem registrar sem consentimento atual, com papel não autorizado, sem nota suficiente ou sem confirmação do administrador. Registros reais não são simulados no banco de produção.

## Arquivos
- `supabase/migrations/20261016180000_ads_assistance_contacts_v1_324.sql`
- `supabase/functions/admin-ops/index.ts`
- `js/admin-activations.js`, `css/components.css`
- `tests/ads-contacts-v1-324.mjs`, `.github/workflows/audit.yml`.
