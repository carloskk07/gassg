# Rede TAMÃO — teste pelo link, pelas telas e pelo banco

Continuação da `main` publicada `7a79ed4fe8a51fd5ebb10fe1cb7795d79fa38f13`.
O proprietário cobrou testes completos antes de convidar clientes ou revendas.
Esta entrega usa a infraestrutura descartável já existente no GitHub Actions:
Auth, Edge Functions, PostgreSQL com todas as migrações e Chrome com sessões
separadas. Nenhuma pessoa, fornecedor ou conta bancária real participa.

## Falha reproduzida e correção

Quando o convite de 30 dias expirava, o armazenamento específico era apagado,
mas `state.user.referredBy` ainda continha o mesmo código. O fallback devolvia
esse código antigo e impedia o novo link de ser atribuído no navegador.

O teste real do helper falhou antes da correção: retornou `FRIEND55` quando o
novo convite deveria produzir `NEWFRIEND88`. A correção elimina também o
fallback correspondente ao registro expirado. Um convite ainda válido mantém
a prioridade original. As regras e vínculos confirmados no banco não mudam.

## Percursos verificados pela integração

| Percurso | Resultado exigido |
|---|---|
| Link de indicação | Abrir `?ref=...`, voltar à home sem o parâmetro e preservar o código original |
| Compra pela interface | Home → Água → CEP → oferta do banco → contato → pedido, usando os botões existentes |
| Persistência | A referência do navegador deve corresponder ao indicador gravado no PostgreSQL |
| Três sessões | Cliente, Parceiro e Admin devem consultar o mesmo pedido; autenticações isoladas |
| Comissão pendente | A API autenticada do indicador deve refletir a concessão do pedido entregue |
| Liberação | Carência, revisão de risco e recebimento da taxa são obrigatórios; repetição não duplica crédito |
| Tela do indicador | Saldo disponível, pendente e contagens visíveis devem coincidir com os dados canônicos, em desktop e celular |
| Pedido ainda não entregue | Pode registrar o vínculo, mas não pode qualificar a indicação nem criar comissão |
| Estorno após liberação | A autoridade canônica do Admin deve zerar a comissão, desfazer a qualificação e preservar o histórico de repasse para revisão; repetição sem novo lançamento, em transação integralmente revertida |
| Falhas e recuperação | Consulta indisponível, perda da referência local, acesso por outro papel e entrega offline seguem os testes existentes |

A mesma execução também roda os cenários existentes de cancelamento, cupons,
devolução, Pix/conciliação simulados, publicidade, mobilidade e permissões.
Não basta este documento existir: consultar os resultados finais na PR desta
entrega e no topo da issue #493.

## Evidências e limites

O artefato `tamao-pedidos-sinteticos-ci` inclui `rede-indicacao.json`, capturas
`14-indicador-comissao-desktop.png` e `15-indicador-comissao-celular.png`, além
de `rede-estorno.json` e das capturas existentes de pedido nos três papéis. A prova usa as páginas,
APIs e tabelas reais apontadas exclusivamente para localhost descartável.

Valores, recebimentos e observações de PSP são sintéticos. Nenhum Pix é
emitido ou pago em produção, e nenhum saque ou recebimento bancário externo
é atestado. A demonstração visual estática do GitHub Pages é outro recurso,
separado desta integração com banco. Esta entrega não habilita comércio,
bonificação de revendas ou rede multinível, nem encerra uma frente comercial
pela simples aprovação dos testes.
