# TAMÃO V1.250 — Histórico de decisões financeiras

## Entrega
Na Central de financiamento e crescimento → **Histórico**, o administrador principal e o perfil Finance podem consultar os eventos financeiros registrados com filtros por **mês da decisão**, centro de incentivo, origem (aporte/campanha) e tipo de decisão.

Os resultados são paginados pelo servidor em grupos de 20, ordenados por data e identificador, sem depender do limite de 50 itens das filas operacionais V1.246 e V1.247. O contador informa o total para os filtros selecionados. Paginação por offset cobre até 10.020 eventos; este limite é declarado no código e páginas além dele ficam desabilitadas.

### Fontes reais
- `platform_owner_contribution_events_v1_246`: declaração, conciliação manual, recusa e contestação.
- `platform_owner_budget_allocation_events_v1_247`: separação de orçamento planejado e devolução ao plano.
- Associação somente de leitura aos respectivos registros para recuperar valor, centro e campanha.
- Data da decisão em **America/Sao_Paulo**. A competência de uma campanha é exibida separadamente da data da decisão.

### Sem inferência de resultado financeiro
Este histórico **não mede ROI, receita, pagamentos Pix, cashback pago nem saldo disponível**. Orçamentos e aportes não são somados como caixa; o retorno comercial exigirá dados reais de pedidos, taxas e atribuição às campanhas.

### Segurança e consistência
- RPC privada com `SECURITY DEFINER`, autorização explícita por `platform_admins` ativo e papel `superadmin` ou `finance`; o wrapper público só tem `EXECUTE` para `service_role`.
- Edge `admin-ops` valida filtro, tamanho, tipos, período, usuário e campos de retorno antes de entregar ao cliente.
- Sem acesso direto a registros financeiros pelo navegador, sem nova permissão de escritura e sem alteração de dinheiro ou benefícios.
- Ao alternar usuário, históricos antigos não são exibidos; falha de consulta limpa a página; observações passam por escape HTML.
- Pesquisas são explícitas, não realizam ações financeiras e não são apresentadas como resultado de API bancária.

## Validação e publicação
1. Aprovar o `node tests/owner-finance-history-v1-250.mjs`, demais testes e build.
2. Aplicar `20261014160000_owner_finance_history_v1_250.sql` no Supabase e verificar ACL e consulta sem dados fictícios.
3. Publicar `admin-ops` preservando configuração JWT e dependências atuais.
4. Integrar a PR, verificar que os três portais receberam o mesmo SHA e passar na prontidão remota.
