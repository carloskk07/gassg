# TAMÃO V1.312 — Instrumento publicitário com aceite eletrônico autenticado

## O que foi implementado
1. A partir de uma minuta V1.311 efetivamente revisada pelo titular, o administrador principal cadastra **razão social e CNPJ declarado da empresa responsável pelo TAMÃO**. O CNPJ da revenda é obtido do cadastro no banco. A emissão fica bloqueada se faltarem identificações mínimas.
2. O sistema registra um **documento JSON imutável**, contendo as duas empresas (razões sociais e CNPJs), preço, prazo, escopo, cancelamento, vencimento sugerido e cláusula de que cobrança/exibição requerem passos futuros separados.
3. O PostgreSQL calcula SHA-256 do conteúdo canonicalizado de JSONB no servidor (pgcrypto) e impede alterações posteriores de documento, hash, emissor e versão da minuta por trigger.
4. O proprietário ativo da revenda consulta o instrumento, lê o documento, marca consentimento explícito, digita **ACEITO** e confirma. A API valida conta autenticada, vínculo, papel owner, hash/versão, integridade e versão vigente da minuta. Gerente somente consulta.
5. Após o aceite do titular, o administrador principal confirma a mesma versão/hash. O resultado é **aceite bilateral autenticado**; são registradas as duas manifestações em tabela privada, com request UUID idempotente e horário de servidor, além de auditoria.
6. Revisões são auditáveis. Um único documento por revenda nesta versão: não há substituição silenciosa depois de emitido; renovação/aditivo exigirá fluxo dedicado posterior.

## Exigências de segurança e limitações
- RLS habilitado, grants diretos negados a `anon` e `authenticated`. Apenas `service_role` acessa as tabelas/RPCs; cada operação também valida papel e identidade no PostgreSQL, além do JWT validado no Edge.
- SHA-256 protege **integridade do documento**, não atesta sozinho a identidade jurídica nem substitui assinatura qualificada.
- O mecanismo coleta **aceites eletrônicos autenticados sem certificação ICP-Brasil**. A MP 2.200-2/2001 art. 10, §2 admite outros meios de comprovar autoria/integridade sob determinadas condições; a adequação jurídica depende da identidade, consentimento, poderes de representação, texto contratual, evidências e contexto. Não há prova de firma, assinatura avançada/qualificada ou identidade verificada na Receita nesta implementação.
- CNPJ da empresa TAMÃO precisa ser informado pelo fundador; não há valor padrão nem preenchimento artificial. O servidor verifica formato e vínculo das contas, não autenticidade cadastral na Receita. Uma validação jurídica adicional pode ser necessária antes de contratar efetivamente.
- **Nenhuma cobrança, checkout, cobrança recorrente, receita, ordem de pagamento, comissão, publicação de anúncio ou abertura de cidade** decorre do aceite. A cobrança específica para TAMÃO Ads e a homologação real da entrega publicitária permanecem projetos separados e desabilitados.
- Não usar esta funcionalidade para afirmar que uma assinatura tem certificado ICP-Brasil; `notIcpCertified=true` é parte obrigatória do contrato de resposta.

## Acesso
- Admin: **Ativações → Aceite eletrônico de publicidade** (emissão e confirmação apenas superadmin).
- Revendas: **Vender mais e ampliar sua rede → Instrumento eletrônico de publicidade** (aceite apenas owner).

## Implantação
Migração `supabase/migrations/20261016060000_ads_electronic_instruments_v1_312.sql`; Edge `admin-ops` e `merchant-ops`; testes `tests/ads-electronic-acceptance-v1-312.mjs` + auditoria, build e propagação Cloudflare. Não executar assinaturas com empresas reais na implantação.
