# TAMÃO V1.1045 — Meu extrato de benefícios

## Experiência da pessoa participante
- **Rede TAMÃO → Meu extrato**: botão abre uma lista legível, sem carregamento extra na página inicial, filtrável por Tudo, Rede, Cashback e Cupons.
- **Clube TAMÃO**: atalho direto para a mesma área (uma conta e as mesmas fontes financeiras).
- Em cada lançamento, apresentar descrição compreensível, origem, data, valor, natureza e situação. Mostrar estados como **em validação**, **validado sem saque**, **utilizado**, **cancelado**, **reservado**, **pago com comprovante** e **transferência interna**.
- Informação de conta é privada: carregamento somente após sessão do Supabase verificada, sem divulgar CPF, Pix, nome do comprador indicado ou detalhes de terceiros. Ao trocar de conta, os dados antigos somem e respostas antigas são descartadas.
- Cashback é **crédito para comprar**, cupom é **desconto**, bonificação direta Ads/Moto/Clube **não é sacável**, participação do fundo 10% tem apuração e regras de saque próprias. Pedidos de saque aparecem como **solicitações**, não dinheiro novo.
- Precisão para a distribuição: valores em microcentavos são mantidos; frações abaixo de R$ 0,01 aparecem como “menos de R$ 0,01”, sem arredondamento artificial nem criação de créditos.
- Páginas de 12 registros com botão “Ver mais lançamentos”; nunca retornar milhares de itens de uma vez.

## Implementação
- Consulta SQL privada e *read only*: network_member_benefit_statement_v1_1045. Não grava transações, não aciona visitas de atividade e nunca inclui outra conta. RLS e RPC disponível somente ao service_role.
- Edge customer-summary valida JWT com auth.getUser, limita taxa de requisições, ignora qualquer ID de usuário enviado pelo navegador e fornece modo statementOnly dedicado, sem executar o fluxo de apuração ou reativar programas.
- Navegador recebe apenas rótulos e valores sanitizados. Os resultados são substituídos no logout/troca de conta; não são gravados em localStorage.
- Arquivo de exibição é carregado de forma dinâmica apenas na consulta (js/growth-benefits-statement.js), respeitando o limite de desempenho do portal.

## Evidências exigidas
1. Audit: tests/network-member-benefit-statement-v1-1045.mjs e todos os contratos preexistentes.
2. PostgreSQL descartável: tests/sql/network-member-benefit-statement-v1-1045.sql em transação revertida. Inclui isolamento de contas A/B, três origens distintas, valor fracionário, filtros e paginação, permissões e nenhum saque criado.
3. Build, smoke visual, deploy três portais com mesmo commit, verificação da function customer-summary implantada com fonte idêntica ao repositório.
4. Não ativar nenhuma política financeira, programa de remuneração ou compra durante esta entrega.

## Limites
- A consulta é um **extrato de eventos**. Valores nas diferentes categorias **não se somam para produzir um saldo geral**.
- A confirmação de saque depende do fluxo bancário existente e do comprovante verificado; este módulo não executa pagamentos.
- O recurso exibe a história existente dos movimentos, sem inventar comissões por convites, compras não homologadas ou campanhas não pagas.
