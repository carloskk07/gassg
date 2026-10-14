# TAMÃO V1.257 — ponte financeira de campanhas e auditoria de comprovantes

## Nova visão consolidada
A área Resultados no Admin reúne, por campanha, taxas da plataforma comprovadas com evento do provedor, separando pedidos individuais V1.253 e lotes V1.254. A soma desses dois números pode ser apresentada como evidência de taxas PSP da plataforma, porque os extratos individuais e agrupados não se sobrepõem.

O painel compara esses valores a despesas de marketing declaradas pelo proprietário (V1.255), separando o total com documento em arquivo privado V1.256 e o total sem anexo.

Somente quando existem valores positivos nos dois lados é exibida a diferença aritmética entre evidências: taxas PSP menos gastos de marketing declarados. **Não é lucro, ROI, saldo disponível, margem líquida ou resultado causal da campanha.** Não inclui incentivos efetivamente pagos, custos operacionais, impostos ou processamento que ainda não estão totalmente vinculados.

A fonte do orçamento de incentivos é separada e não entra como despesa já paga.

## Consulta de órfãos no Storage
Uma consulta privada e restrita aos administradores financeiros audita o bucket de comprovantes:
- total de objetos;
- objetos com vínculo de metadados;
- uploads recentes sem vínculo, protegidos durante 24 horas;
- arquivos sem vínculo há mais de 24 horas, classificados como candidatos a revisão;
- contagem de objetos com caminho fora do padrão.

Nenhuma consulta elimina arquivo algum. Não há exclusão automática nem exposição dos caminhos dos arquivos; arquivos vinculados a despesas corrigidas continuam protegidos.

Um arquivo sem vínculo pode representar uma finalização que falhou após o upload; por segurança, revisão precede qualquer exclusão. Uma futura ação de remoção deverá obter confirmação explícita, nova checagem da idade e vínculo no servidor e produzir registro auditável.

## Privacidade e permissões
A API do Admin exige autenticação e papéis superadmin/finance. As RPCs públicas de consulta só são executáveis pelo service_role do backend. As rotinas privadas exigem perfil ativo e validam competência. Nenhuma tabela financeira, objeto de Storage ou registro de marketing é mutado por esta implementação.

## Limitações e próximo passo
Atualmente a consulta não confirma extrato bancário. Comprovante enviado por um administrador também não constitui validação independente de pagamento. Para indicadores finais de rentabilidade será necessário apurar outras despesas (incluindo incentivos) e confirmar movimentações bancárias e custos totais.

## Arquivos alterados
- supabase/migrations/20261014230000_owner_campaign_financial_bridge_v1_257.sql
- supabase/functions/admin-ops/index.ts
- js/admin-acquisition.js e js/bootstrap.js
- tests/owner-campaign-financial-bridge-v1-257.mjs
