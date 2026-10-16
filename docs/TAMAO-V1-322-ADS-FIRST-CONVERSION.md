# TAMÃO V1.322 — Converter interesse em primeiras propostas reais de publicidade

## Motivo
A infraestrutura contratual e financeira já chegou à V1.321, mas faltam campanhas aprovadas e adesão comercial. O gargalo atual é levar revendas interessadas a preparar a primeira campanha.

## Admin — primeiras oportunidades comerciais
Na Central de Ativações, **Quem está pronto para começar a anunciar?** reúne somente revendas que já registraram interesse na publicidade TAMÃO Ads. Exibe contagens reais de interessados, criativos aprovados e revendas preparando a apresentação, com prioridade por etapa: aprovado para planejamento, peça em análise, rascunho preparado, pendência de ajustes/catálogo, localização e habilitação da revenda.

A consulta admin_ads_leads_v1_322 valida perfil autorizado no PostgreSQL, lê cidade/UF, estoque de produtos ativos com entrega habilitada e status da campanha, sem inferir consentimento para marketing direto, disparar mensagens ou contato automático. São exibidos até 50 registros priorizados, com total apurado separadamente.

## Revenda — primeiro rascunho num clique
No guia da V1.321, **Criar meu primeiro rascunho** aparece quando o servidor confirma revenda ativa, endereço de negócio, interesse registrado e catálogo compatível, sem apresentação existente. O proprietário/gerente precisa confirmar a ação, e uma nova checagem do servidor é feita imediatamente antes de salvar.

A ação reaproveita o backend existente de campanha, cria apenas uma peça em estado draft, verifica a leitura de retorno e abre o editor para personalização. Textos iniciais são neutros: não afirmam preços, prazos ou vendas. A revenda pode editar e só depois decidir voluntariamente quando enviar para revisão.

## Segurança
- Leitura administrativa sem mutações, SECURITY DEFINER e search_path fixo, execução apenas service_role e sem grants a anon/authenticated.
- Controle de permissão independentemente no Edge e no SQL.
- Não há automação de disparo, aprovação de campanhas, pedidos, faturamento, pagamentos, publicação de Ads ou abertura de cidades.
- Não foram inseridos registros comerciais artificiais em produção.
- Testes garantem confirmação explícita, elegibilidade atual, versão de criativo não duplicada e ausência de submissão automática.

Arquivos: supabase/migrations/20261016160000_ads_lead_conversion_v1_322.sql, supabase/functions/admin-ops/index.ts, js/admin-activations.js, js/merchant.js, css/components.css, tests/ads-first-conversion-v1-322.mjs.
