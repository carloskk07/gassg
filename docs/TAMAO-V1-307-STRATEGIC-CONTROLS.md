# TAMÃO V1.307 — Central de ativações estratégicas

## Entrega

Nova aba **Ativações** no painel administrativo, para superadmin, operações e somente leitura. Reúne publicidade, negociações do Clube/patrocínios, política de benefícios, notificações push, pagamentos e autorização de cidades.

- Carregamento independente de evidências com `Promise.allSettled`: falha de uma origem não derruba todas.
- Leitura pelos endpoints autenticados e existentes: `ads-placement-readiness`, `ads-campaign-queue`, `clube-campaign-queue`, `clube-terms-queue`, `governance-gates`, `admin-push-reliability`.
- Os dados são associados ao usuário e ao perfil da sessão. Confirmação mais antiga que dez minutos não é usada para representar o estado atual; leitura sem contrato confiável gera **Não confirmado**, não “desligado”.
- Caminhos das ações levam às páginas oficiais com autorização no servidor. Um perfil de somente leitura não recebe acesso à página financeira por meio da nova central.
- A central não envia nenhuma mutação administrativa nem libera cidades, cupons, patrocínios, pagamentos automáticos ou avisos. Os controles e auditorias originais seguem obrigatórios.

## O que não foi liberado

Aprovação editorial de anúncios continua diferente de exibição e cobrança. Negociação de um pacote do Clube continua diferente de ter contrato assinado, patrocínio verificado e cupom comercializado. Configuração de PSP não prova pagamento real, e push aceito pelo provedor não prova que apareceu no aparelho. A autorização da cidade é apenas um dos requisitos de uma operação habilitada.

A V1.307 **não cria flags desligadas no front-end para simular controles administrativos efetivos**. Para que novas ativações (publicação de publicidade, vendas de cupom, novos disparos automáticos) possam ser geridas integralmente no painel, cada módulo ainda precisa de um fluxo próprio de aprovação no servidor, contratos, validação financeira, auditoria e teste operacional antes da exposição de um botão de habilitação.

## Validação

`node tests/admin-activations-v1-307.mjs` verifica papel administrativo, vinculação à sessão, contratos das fontes, tela em falha fechada, navegação para fluxos existentes e ausência de ativação pelo painel. O teste entra na auditoria completa de CI.

## Próximas decisões

Revisar o primeiro fluxo realmente elegível a operar em produção — com prioridade à revenda e sua venda real — antes de ampliar publicidade patrocinada ou comprometer orçamento promocional. A autorização comercial de São Gabriel continua sendo decisão exclusiva do administrador principal.
