# TAMÃO V1.1044 — Rede mais atraente com bônus diretos financiados por receita real

## Resultado técnico
- **Moto/Carro:** bonificação direta de até **5% do NET** do primeiro pacote pré-pago de tarifas do motorista indicado, somente após utilização integral do crédito, conciliação do Pix com relatório NET do PSP, pelo menos 7 dias de maturação e ausência de estorno. Nunca sobre corridas ou tarifas de terceiros.
- **Clube:** até **5% do NET da primeira compra de pacote**, estritamente se financiado pelo parceiro que assume os descontos, com acordo assinado, sem patrocínio próprio, conciliação NET, 7 dias e sem pedido de estorno. Cupons patrocinados pelo TAMÃO não geram comissão.
- **Profissionais:** a indicação de um profissional que comprar sua primeira publicidade paga participa do bônus de anunciantes de até 5% NET da primeira campanha. A mesma campanha não gera uma segunda comissão de Profissionais. Anúncios gratuitos não pagam.
- **Fundo 10%:** mantido exclusivamente para pacotes de redução de tarifas de revenda e Moto/Carro. O bônus direto de Moto/Carro é adicional; caso ambos sejam ativados, podem representar **até 15% do NET** no mesmo pacote, antes de demais custos e tributos.
- Caronas gratuitas continuam sem recompensa financeira; Hospedagens continuam suspensas.

## Segurança
1. Políticas network_direct_module_policy_v1_1044 começam desligadas para Moto/Carro e Clube, percentual máximo de 500 bps, com termos aprovados/publicados exigidos para futuras apurações.
2. Bonificações network_direct_module_awards_v1_1044 são únicas por usuário indicado e por modalidade, comprovadas por receita verdadeira, sem duplicação nem cálculo sobre compras anteriores à ativação.
3. Estornos e disputas são reavaliados antes de qualquer novo lançamento, mesmo com o programa posteriormente suspenso; lançamentos revertidos não são apagados nem reaproveitados.
4. **Nenhum bônus novo entra em carteira, saldo sacável, abatimento interno ou Pix.** Conectar a trilha aos saques exigirá outra prova de conservação financeira e estorno, sem duplicar a fonte.
5. As tabelas possuem RLS e ACL privadas, RPCs exclusivamente de serviço, e alteração de configuração só pelo Superadmin com termo versionado. Admin Financeiro possui leitura sem autorização para ligar o benefício.
6. Cliente e Admin exibem dados confirmados por fonte, de modo separado dos saldos existentes, e sem linguagem de renda garantida.

## Limite comercial hoje
A regra de banco do Clube mantém a cláusula CHECK (NOT sales_authorized) nos acordos de cupons financiados por parceiros. **Portanto nenhum pacote do Clube está apto a conceder esta comissão agora.** Não remover o bloqueio nem transferir o custo para o fundador; o benefício já estará implementado para quando houver um parceiro financiador autorizado e prova de receita.

Listagens gratuitas de Profissionais não possuem lançamento NET de plano próprio verificado; só a compra de publicidade independente pode acionar o bônus preexistente, se este estiver habilitado.

## Evidências de engenharia
- Contrato JavaScript: tests/network-direct-module-rewards-v1-1044.mjs.
- Regressão real de PostgreSQL descartável com ROLLBACK: tests/sql/network-direct-module-rewards-v1-1044.sql (Auth sintético, indicação, NET sintético, 5% limitado, cupom subsidiado bloqueado, RLS, idempotência, reversão com política suspensa).
- CI: Audit e integração Supabase/PostgreSQL isolada. Nenhuma identidade ou PSP sintético é inserido em produção.

## Próxima decisão comercial
A versão pública dos termos da Rede deve especificar quais modalidades têm bonificação, que o dinheiro não está disponível para saque nesta fase, e o potencial custo total de incentivos quando houver fundo 10% e bônus direto 5%. Nunca usar minuta como comprovação de aceite real.

As 19 frentes técnicas originais permanecem tecnicamente encerradas; esta é uma melhoria posterior e não prova vendas ou repasses reais.
