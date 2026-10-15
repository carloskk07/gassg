# TAMÃO V1.310 — oferta Ads no portal e resposta do titular

## Operação
- O fundador usa **Admin → Ativações → Planejamento comercial de anúncios** para disponibilizar ao painel da revenda um plano interno V1.309 que esteja em `ready_for_contact`, na mesma versão de peça aprovada.
- O banco fixa preço, duração, versão do plano, versão do criativo, autor e validade de **14 dias**. Nenhuma ação é enviada ao WhatsApp, push ou e-mail.
- O titular acessa **Portal das Revendas → Vender mais e ampliar sua rede → Condições para divulgação**, consulta a oferta e pode confirmar **interesse comercial não vinculante** ou **não interesse**. Gerentes podem visualizar, mas **não responder**.
- O registro identifica o usuário autenticado, função owner, timestamp, solicitação UUID, versão/condições aceitas e histórico da mudança. A resposta exige consentimento explícito no painel e uma confirmação adicional.
- O fundador pode retirar ofertas pendentes; ofertas respondidas ficam preservadas. Para reapresentar novas condições, precisa haver **novo plano interno** versionado. Reenvio de mesma solicitação retorna replay, sem segunda mudança.
- Ofertas expiradas, peças alteradas ou retiradas não podem receber aceites. Ausência de resposta não é interpretada como aceite.

## Fronteiras
- `interested` **não constitui contratação**: significa apenas que o titular demonstrou interesse nas condições.
- `shared` significa apenas que a oferta está disponível na tela; **não comprova que foi vista**, e não envia notificação.
- Nenhum pagamento, fatura, autorização de cartão, destaque, impressão, cron, comissão, cupom, abertura de cidade ou receita é criado.
- Para comercialização efetiva, será necessário futuro processo separado de contratação, condições definitivas, comprovante financeiro e prova de exibição.

## Proteções
- Tabelas de oferta e ações privadas com RLS, sem `GRANT` de acesso para `anon` e `authenticated`.
- RPCs executáveis apenas por `service_role`; Edge valida JWT, vincula `p_actor` ao usuário e checa papéis. O PostgreSQL valida novamente superadmin/owner.
- Versão concorrente, row locks, assinatura de `request_id`, log administrativo; resposta vinculada à revenda da sessão e nunca confiada ao ID sem autorização.
- Leitura restrita a superadmin/operations/readonly no Admin e owner/manager na revenda. Nenhum dado de outro estabelecimento é acessível.
- Testes: `node tests/ads-offer-v1-310.mjs` e regressões V1.307–V1.309.

## Implantação
1. Aplicar `supabase/migrations/20261016040000_ads_offers_v1_310.sql` antes da nova Edge.
2. Publicar **ambas** Edge Functions `admin-ops` e `merchant-ops`, preservando `verify_jwt=false` com verificação interna JWT.
3. Confirmar RLS, grants, nenhuma oferta adicionada no deploy, nenhuma cidade aberta.
4. Aprovar CI e publicar/verificar os três portais Cloudflare.
