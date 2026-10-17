# TAMÃO V1.403 — Validação operacional da jornada do parceiro piloto

## Evidências observadas em 17/10/2026
Consulta **somente leitura** no banco de produção:
- 1 cadastro piloto;
- 2 convites históricos (1 revogado, 1 ativo e não reivindicado);
- 0 convites reivindicados;
- 0 solicitações empresariais pendentes;
- 0 solicitações ligadas a piloto;
- 0 cidades com comércio habilitado;
- Edge `admin-ops` ativa na versão 173 quando verificada, antes da publicação desta alteração.

**Conclusão:** não é possível afirmar que convite -> cadastro -> reivindicação -> aprovação -> ativação tenha passado em produção. Falta um parceiro real concluir o convite ativo ou receber um novo convite.

## Correções V1.403
1. A conversão administrativa de piloto permite selecionar a UF real, sem impor `RS` a todas as cidades. A cobertura "cidade inteira" refere-se à cidade preenchida, não à São Gabriel.
2. A função de conversão no navegador, mesmo chamada sem o botão, bloqueia cadastros cancelados/convertidos e exige `ownerClaimed=true` com solicitação vinculada `pending` ou `approved`, antes de confirmar.
3. Somente a Edge e o PostgreSQL decidem a vinculação da conta permanente; `ownerUserId` continua sem escolha manual. Nenhuma das novas condições no navegador substitui a autorização do servidor.
4. Teste de regressão exercita seleção de UF, convite não reivindicado, solicitação rejeitada, piloto convertido/cancelado e preservação dos limites de autoridade.

## Ensaio final com operador autorizado
- No painel administrativo, acesse **Parceiros**, identifique o piloto e confirme o convite ativo. Não há necessidade de gerar um segundo link enquanto o atual ainda estiver acessível ao responsável.
- O responsável real abre seu link oficial em **parceiro.tamao.com.br**, entra com conta permanente e e-mail confirmado e envia o cadastro da própria empresa.
- Confirme no painel que o mesmo usuário reivindicou o convite e que a solicitação está pendente. Não aceite vínculo presumido apenas por CNPJ ou nome.
- Revise a razão social, CNPJ, telefone, cidade e **UF**, produto, preço, estoque, pagamento e cobertura. Caso necessário, devolva o cadastro para correção.
- Somente com autorização explícita execute aprovação/conversão pelo painel. Confira depois que a revenda permaneceu **pending/offline**, que a cidade permaneceu sem liberação comercial e que o catálogo existente não foi rebaixado.
- Faça validação regulatória, representação, pagamento e condições de oferta por etapas distintas. Abertura comercial depende de aprovação administrativa independente.

## Limites
Os testes automatizados são **simulados**. Um teste com uma conta real ainda requer a participação de um parceiro autorizado. Não foram criados pedidos, pagos créditos, enviada mensagem real, executada aprovação, movimentado estoque nem aberta cidade nesta entrega. A consulta SQL de diagnóstico agregada fica em `scripts/pilot-operational-preflight-v1-403.sql`, sem expor nomes, CNPJ ou tokens.

Continua preservada a V1.401: tentativa de aprovação com revenda ativa ou SKU comercial ativo/com estoque falha fechada no PostgreSQL.
