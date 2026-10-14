# TAMÃO V1.270 — A vida da revenda em primeiro lugar

## O que mudou

A experiência da revenda passa a destacar o **próximo passo incompleto**: produtos, entregas ou recebimentos. A ação leva à configuração existente, sem criar novos formulários, contas ou obrigações.

Em recebimentos, Pix, cartão e dinheiro na entrega permanecem o caminho mais simples. Ao salvar, as rotas manuais continuam sendo criadas pela lógica atual, sem passar a receita pelo TAMÃO.

A lista técnica de prestadores agora segue divulgação progressiva:
- PSPs conectados ou declarados ficam visíveis no painel.
- Prestadores ainda não escolhidos ficam dentro de «Escolher outro banco ou maquininha (opcional)».
- As opções de conectividade e os diagnósticos técnicos permanecem acessíveis, mas não tomam o espaço principal.
- Diagnósticos de prontidão ainda abrem os painéis de configuração, e o detalhamento das etapas de homologação continua disponível.

## Limites de segurança

Nenhuma revenda é declarada apta apenas porque preencheu três etapas. A autorização do servidor, compliance, verificação de pagamentos, geografia e bloqueios financeiros existentes não foram alterados.

Nenhuma migração, Edge Function, valor, transferência ou ativação automática foi alterada. Nenhum PSP foi promovido de catálogo para integração homologada.

## Verificação

Regressão dedicada `tests/merchant-easy-start-v1-270.mjs`, teste da V1.269, teste de fallback V1.138, auditoria geral e E2E móveis.
