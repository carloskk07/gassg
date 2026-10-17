# TAMÃO V1.402 — Evidência de convite reivindicado no painel

O cadastro empresarial e o convite piloto são registros distintos. A existência de um cadastro vinculado a `pilot_partner_draft_id` **não comprova** que o responsável abriu e reivindicou o convite.

## Mudança de confiabilidade
A projeção de `pilotPartners[].onboarding` em `admin-ops` passa a considerar o convite reivindicado somente quando o registro de `pilot_partner_invites` tem data e usuário da reivindicação **e** seu `application_id` e `claimed_user_id` coincidem com a solicitação empresarial realmente vinculada. Um convite antigo ou reivindicado por outra pessoa não libera a indicação visual de conversão.

- O progresso **Conta vinculada**, `ownerClaimed`, `inviteStatus='claimed'` e `nextAction='review_and_convert'` seguem o mesmo vínculo comprovado, em vez de inferi-lo da mera presença de uma solicitação.
- A lista de solicitações administrativas mostra o parceiro piloto, o estado do vínculo e um atalho para revisar os dados.
- Ao aprovar uma solicitação associada a parceiro piloto, a interface exige evidência de reivindicação correspondente, resumo recente e confirmação explícita. Uma solicitação comum permanece aprovável com confirmação.
- O banco preserva a autoridade final: `admin_assisted_merchant_onboarding_v2` verifica conta permanente/e-mail confirmado; a V1.401 protege contra sobrescrita de revenda ativa e estoque. Estes controles da UI não substituem a verificação na Edge e no PostgreSQL.

## Limites e operação

O resumo administrativo pagina os primeiros 50 cadastros e 50 pilotos. Quando o parceiro não está no resultado, o painel **não inventa a vinculação nem permite aprovar como se tivesse visto a reivindicação**: pede atualização e revisão. A ação é idempotente/autorizada pelo serviço, sem criar revendas automaticamente.

Nenhuma migração SQL, concessão de acesso, transação, ativação comercial ou envio de convite é executado por esta mudança. `tests/pilot-claim-evidence-v1-402.mjs` valida o estado de reivindicação, conflitos, dados ausentes, paginação insuficiente, resumos obsoletos e navegação. Os testes são simulados; ainda é necessária validação com um convite real por operador autorizado para comprovar o fluxo completo.

A [PR #38](https://github.com/carloskk07/gassg/pull/38) incluía seleção manual de staging durante aprovação. A jornada atual usa convite atribuído ao próprio parceiro e vinculação por conta permanente. Não restaurar seleção arbitrária de staging sem um desenho explícito de autorização e testes de identidade.
