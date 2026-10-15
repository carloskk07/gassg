# TAMÃO V1.311 — Dossiê comercial Ads e preparação de cobrança

## Escopo implementado
- A V1.311 começa **somente quando o proprietário da revenda expressa interesse** na oferta comercial V1.310. Interesse não é contrato.
- O administrador principal prepara uma **minuta para revisão** com preço e duração copiados da oferta aceita (imutáveis nesta etapa), escopo de divulgação de 60 a 700 caracteres, condições de cancelamento de 40 a 700 caracteres e prazo de vencimento proposto de 1 a 30 dias.
- Estados do dossiê: `draft`, `shared_for_review`, `changes_requested`, `reviewed` e `withdrawn`. Nenhum é contrato assinado ou cobrança emitida.
- Fundador pode salvar, disponibilizar para revisão e retirar minuta compartilhada. Não há e-mail, WhatsApp ou push implícito.
- Titular da revenda, em seu portal, pode confirmar que **leu/revisou** ou **solicitar alterações**, com checkbox explícito e confirmação individual. Gerente visualiza; não responde.
- O fundador pode editar após alterações solicitadas e compartilhar uma nova versão. Uma confirmação de leitura não autoriza editar silenciosamente a minuta revisada.

## Evidências e segurança
- Todas as operações são atômicas, versionadas, vinculadas ao usuário autenticado, auditadas em `platform_admin_audit` e idempotentes por request UUID+assinatura.
- Tabelas privadas com RLS e sem grants a anon/authenticated. Somente service_role executa RPC; Edge e PostgreSQL conferem os perfis independentemente.
- Dossiê só é criado sobre oferta interessada, com criativo ainda aprovado e não publicado. Consulta da revenda nunca revela minuta em rascunho.
- A resposta do titular bloqueia versões desatualizadas, exige confirmação explícita e não equivale à assinatura.

## Importante: fronteiras financeiras e regulatórias
Esta versão **não assina documento, não gera contrato executável, não emite fatura, não inicia checkout, não verifica pagamento, não marca receita e não publica anúncios**. O vencimento é apenas uma condição futura proposta; a plataforma continua segregando a cobrança publicitária dos créditos e taxas operacionais das revendas. Para cobrar será necessária a formalização legal apropriada, o consentimento contratual válido, o provedor PSP configurado para receitas da plataforma e conciliação independente.

## Publicação
- Migração: `20261016050000_ads_contract_dossiers_v1_311.sql`
- APIs: `admin-ops` e `merchant-ops` (sem alteração do mecanismo atual de validação JWT)
- UI admin: **Ativações → Condições contratuais e cobrança futura**
- UI revenda: **Vender mais e ampliar sua rede → Revisão das condições**
- CI: `tests/ads-contract-dossier-v1-311.mjs`, regressões anteriores, builds e verificações Cloudflare.
