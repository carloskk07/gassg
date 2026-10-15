# TAMÃO V1.276 — Disponibilidade simples no painel da revenda

## Experiência

O painel real da revenda passa a começar com **Sua operação agora**, sem obrigar o comerciante a procurar o botão de ficar online no final da página.

Exibe o estado retornado pelo backend (online, pausado, sem confirmação recente de conexão ou novas vendas suspensas por pendência financeira), estoque P13, quantidade de produtos ativos com estoque, taxa registrada de entrega e número de pedidos ativos já recebidos do servidor.

Existe **um único botão** para Ficar online / Pausar novos pedidos. Ao estar offline e não cumprir habilitação, logística, catálogo, meios de pagamento ou regularidade financeira, o botão de ativação fica indisponível. Ao estar online, pausar continua possível mesmo havendo pendências, e não cancela pedidos em andamento. Mudanças são feitas somente pelo fluxo `merchantSetOnlineLive` / `merchant-ops`, com nova leitura dos dados após sucesso.

Proprietários e gerentes veem **Ajustar estoque e preços** (abre o catálogo já existente) e **Ajustar entregas** (abre automaticamente a seção de configurações existente e posiciona o cursor na taxa de entrega). Operadores podem controlar online/offline mas não recebem atalhos de edição; motoristas seguem com painel próprio. Não há duplicação de formulários ou permissões.

## Segurança

Sem mutações de banco, Edge Functions, novos endpoints, novos métodos de pagamento, mudança de limite de pedidos, habilitação antecipada ou movimentações financeiras. Valores de estoque e entrega são informativos; ações de gravação continuam na lógica e permissões originais.

## Verificação

`tests/merchant-availability-v1-276.mjs` testa estado online/offline, bloqueios, financeiro, conexão, papéis, apenas um botão e navegação permitida. Incluído na auditoria; builds e E2E para telas de 320/360/390 px.
