# TAMÃO V1.388 — Painel operacional unificado da revenda

17/10/2026

## Objetivo

Reduzir o esforço para identificar o que precisa de atenção no portal da revenda, principalmente pelo celular. A fila já tinha ofertas, entrega, ocorrências e resumos, porém cada assunto exigia percorrer blocos diferentes da mesma página.

## Interface

O novo quadro **O que precisa da sua atenção agora**, dentro da seção **Pedidos que exigem ação**, agrupa três frentes:

1. **Novos pedidos:** total de propostas recebidas, diferenciação de prazos verificados e não verificados, destaque da proposta com menor prazo ainda válido. O botão leva ao cartão real para conferir o aceite; não o confirma automaticamente.
2. **Entregas:** pedidos em saída ou chegada informada, com prioridade àqueles cuja chegada foi registrada. O botão abre o cartão correspondente, preservando verificações de saída, recebimento, pagamento e PIN.
3. **Atenção:** pedidos em `AT_RISK` e pedidos com atendimentos `open` ou `in_review` recebidos da projeção autorizada V1.386. Contagens por pedido são deduplicadas; o texto apresenta separadamente imprevistos e chamados. Nunca muda o estado nem encerra atendimento.

O quadro fica antes da lista. Os indicadores detalhados existentes, incluindo os blocos das V1.386/V1.387, ficam atrás de **Ver detalhes e indicadores de pedidos** para reduzir ruído visual, mas a fila e seus botões continuam acessíveis diretamente. Essa seção começa recolhida no celular e no desktop.

## Autoridade e segurança

- Exibido somente para `owner`, `manager` ou `operator` e com lista pertencente à instância autorizada da revenda, confirmação da conexão e leitura de pedidos com no máximo 120 segundos.
- Não aparece com carregamento, troca de revenda, resultado antigo, erro de leitura ou para `driver`.
- Toda navegação usa UUID de pedido verificado e o controle `merchantFocusLiveOrder`. Não executa aceite, reatribuição, finalização, pagamento ou alteração de atendimento.
- Propostas com prazo ausente ou expirado não contam como propostas com prazo válido e não se tornam autorizações implícitas.
- Ausência do escopo `merchant-active-orders` não se transforma em afirmação de zero chamados; os dados de suporte são descritos como indisponíveis.
- Sem alteração de funções Supabase, RLS, pagamentos, comissões, abertura de cidades ou permissões do administrador.

## Validação

O teste `tests/merchant-unified-workspace-v1-388.mjs` cobre a classificação, a ordem das ofertas e entregas, os incidentes sem contagem dupla, o isolamento por papel e revenda, leitura recente, IDs inválidos, privacidade e a presença dos fluxos legados.

A publicação exige auditoria e build isolado dos três portais antes da integração à `main`, com verificação Cloudflare e reconciliação separadas. Os indicadores refletem somente os pedidos retornados pela última consulta, não um histórico total nem uma promessa de entrega.

## Medição futura

Avaliar com dados reais o tempo até a primeira ação, o uso da fila e a necessidade de abertura dos painéis detalhados; não alegar melhora de conversão ou redução de chamados antes da medição.
