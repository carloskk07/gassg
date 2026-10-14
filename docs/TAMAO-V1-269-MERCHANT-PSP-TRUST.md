# TAMÃO V1.269 — Confiança e prova real na homologação de PSPs

## Problema corrigido

O painel de revenda anteriormente exibia **INTEGRAÇÃO VERIFICADA** quando a conexão estava ativa e a capability de pagamentos diretos estava habilitada. Esse estado não exige, por si só, uma venda liquidada ou evidência de provedor; a central admin V1.142 já exigia também validação e prova E2E.

## Implementação

- Uma conta somente aparece como **INTEGRAÇÃO VERIFICADA** quando tem conexão ativa, habilitação de pagamentos diretos, autoridade de verificação pelo PSP e capability de prova E2E.
- A conta com automação ativa sem a primeira evidência aparece como **AUTOMAÇÃO ATIVA**. A conta com automação habilitada mas sem capacidade de validar aparece **INCONSISTENTE**.
- Conta conectada com histórico E2E, mas sem automação ligada, aparece como **AUTOMAÇÃO PAUSADA**; a evidência histórica continua no checklist.
- A revenda recebe a próxima ação e um checklist opcional de quatro etapas, sem induzir a geração de pagamentos simulados.
- Uso manual declarado, sem compartilhamento de credenciais, continua disponível. A automação não é obrigatória para confirmar recebimento na entrega.
- Preflight do painel admin vale no máximo dois minutos e fica vinculado ao usuário administrativo, revenda e provedor consultado. Um resultado antigo bloqueia o botão visual de ativação e exige repetir o checklist. O backend já revalida os gates imediatamente antes de qualquer mudança e segue como autoridade final.

## Invariantes

Nenhuma migração, Edge Function, credencial ou movimentação de valores foi alterada. Não existe envio de comissão, criação de checkout, transferência ou teste fictício nesta evolução. O dinheiro das vendas segue diretamente para cada revenda.

## Validação

Teste de regressão obrigatório tests/merchant-psp-trust-v1-269.mjs, além dos testes existentes para o primeiro piloto PSP, fallback manual, RLS e builds mobile.
