# TAMÃO V1.248 — Conferência de aportes pelo administrador principal

## Decisão
O responsável pelo TAMÃO pode registrar e conferir seus próprios aportes na área
**Admin → Aquisição → Aportes e comprovantes bancários**, sem depender de outro
administrador. O fluxo exige as referências da transferência e do extrato, uma
justificativa, o status escolhido e uma decisão explícita.

## Permissões efetivas
- **superadmin ativo**: declara aportes e confere os próprios ou de terceiros;
  pode conciliar manualmente, recusar e contestar registros conforme transições da V1.246.
- **finance ativo**: pode declarar; somente confere aportes criados por outras contas.
- Demais perfis: acesso negado.
- A validação é feita **no banco** (função com checagem de `platform_admins`) e na
  interface, não apenas via botões. Inativos continuam bloqueados.

## Preservado
- Identificador único de transferência, referência do extrato para conciliação,
  anotação com tamanho mínimo, autor da declaração e revisor, data da decisão.
- UUID de operação idempotente, travas transacionais, controle de versão e eventos
  imutáveis; dados sensíveis não aparecem na home pública.
- RLS e privilégios fechados para escrita direta via Data API.
- A conferência interna **não prova saldo bancário por API**: nenhum valor é
  disponibilizado automaticamente para gasto, cashback, comissão, cupons ou Pix.
- A distribuição de orçamentos **planejados** da V1.247 permanece independente
  de depósitos e saldo disponível.

## Implantação
1. Aplicar a migração nova `20261014150000_owner_funding_self_review_v1_248.sql`
   **sem editar ou reaplicar a V1.246**.
2. Validar com contas de teste: superadmin declara e confere seu registro;
   finance não confere o próprio, mas confere o de outro; perfis inativos negados.
3. Verificar referência única, concorrência, idempotência e nenhuma liberação de
   pagamentos ou benefícios.
4. Publicar portal administrativo, conferir versionamento remoto e documentação.

Sem migração no Supabase, a interface atualizada não deve ser considerada
operacional: o banco continuaria rejeitando a auto-conferência.
