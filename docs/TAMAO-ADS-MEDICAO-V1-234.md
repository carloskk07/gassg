# TAMÃO Ads — Medição e prontidão comercial (V1.234)

## Por que não cobrar ainda

Os dados atuais em `prelaunch_marketing_event_daily` representam eventos de navegação
enviados pelo navegador (landing_view e lead_form_view), sujeitos a repetição
e automação. O coletor já limita requisições por IP/hora, mas isso **não**
comprova que um acesso seja humano, local à cidade nem único. IP e origem podem
ser forjados ou mascarados. Parâmetros UTM são informados pelo cliente.
**Não é inventário publicitário vendável.**

## Entrega operacional V1.234

- Painel Admin/Aquisição consulta os contadores reais de eventos observados
  nos últimos 30 dias e uma série diária de 14 dias (UTC).
- Procura **declarada pelas revendas** por cidade: opt-ins e peças publicitárias
  submetidas/aprovadas. Isso é diferente de visitantes dessa cidade.
- Somente administradores autenticados nas funções autorizadas podem
  consultar a RPC agregada, que não expõe IP, hash, referrer, telefone,
  endereço, ID de visitante ou identificadores de leads.
- Valores que permanecem em **zero obrigatório**: impressões publicitárias
  verificadas, cliques publicitários verificados, eventos faturáveis e receita Ads.
- `readyToSell=false`, `adsLive=false` e `noCharge=true` no contrato
  backend, mesmo quando existirem acessos e intenções.
- Nenhuma nova coleta de dados pessoais ou de navegação; sem cookie, tag,
  pixel, fingerprint ou terceiros novos.

## Critérios técnicos antes da primeira campanha vendida

1. **Inventário separado do catálogo orgânico:** posição reservada e
   visualmente rotulada como **Patrocinado**, sem influenciar ranqueamento,
   elegibilidade nem preço de ofertas.
2. **Entrega real auditável:** renderização efetiva de criativo previamente
   aprovado e elegível na cidade/categoria; não computar pré-carregamento
   e não gerar impression por um simples request de API.
3. **Medição robusta:** evento servidor↔cliente correlacionado com nonce curto,
   TTL e chave idempotente para detectar replay, limites por sessão e campanha,
   antifraude/rate limits documentados e amostragem de qualidade.
4. **Privacidade:** definir finalidade, base legal e retenção mínima, consentimento
   quando aplicável, transparência de patrocinador e controles de acesso.
   Sem usar dados pessoais de pedidos para segmentação publicitária sem base legal.
5. **Faturamento independente:** orçamento e contrato explícitos, custo
   aprovado, conciliação de recebimentos, estorno/contestação e ledger
   separados de GMV de revendas e créditos antecipados de taxa TAMÃO.
6. **Prova local de valor:** audiência elegível por cidade comprovada,
   anunciante real, entrega funcionando, métricas auditadas, relatório
   sem números inflados e revisão humana de reclamações.
7. **Gates finais:** teste adversarial de replay e bot, multi-tenant,
   anti-manipulação do ranking, QA mobile, backup e capacidade operacional
   dos serviços antes de habilitar compra.

## Dicionário dos indicadores

| Indicador | Interpretação correta |
|---|---|
| `landingCustomerEvents` | Eventos de abertura da landing para clientes recebidos, não pessoas |
| `landingMerchantEvents` | Eventos de abertura da landing de revendas recebidos |
| `customerFormEvents` | Eventos de exibição do formulário de clientes |
| `merchantFormEvents` | Eventos de exibição do formulário de revendas |
| `last7dEvents` | Soma de todos esses eventos em 7 dias UTC |
| `activeDays` | Dias com algum evento registrado em 30 dias UTC |
| `cityDemand` | Interesse e propostas de revendas com cidade no cadastro, não tráfego local |
| `verifiedAdImpressions` | Sempre 0 até existir entrega verificável de anúncios |
| `billableImpressions` | Sempre 0 enquanto não houver contrato e medição auditável |
| `adsRevenueCents` | Sempre 0 no modelo Ads atual, independente de créditos/taxas |

**Não exibir os valores de eventos como visitantes únicos ou estimar CPM,
CPC, conversão publicitária e alcance geográfico usando essas contagens.**
