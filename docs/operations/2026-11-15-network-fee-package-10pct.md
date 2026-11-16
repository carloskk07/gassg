# Rede TAMÃO — 10% dos pacotes de taxa reduzida (decisão e limites de implementação)

**Escopo escolhido pelo proprietário em 15/11/2026:** somente pacotes pré-pagos de **revendas** e **moto/carro** que concedem taxas menores. **Excluídos expressamente:** pacotes de cupons, publicidade, vendas de mercadorias, cashback e compras individuais.

## Percentual de custo total, sem sobreposição

- **Teto único:** 10% dos valores líquidos verdadeiramente conciliados com o PSP para compras dos pacotes elegíveis; nunca 10% do valor nominal de mercadorias, do crédito de cupons ou de pagamentos que não pertencem ao TAMÃO.
- **Rateio base: 8% do líquido** para participantes elegíveis ativos nas 24 horas anteriores ao fechamento. Todos recebem igual *fração de participação*; valores menores que 1 centavo devem acumular matematicamente, não criar crédito artificial.
- **Bonificação de indicação de revenda: até 2% do mesmo líquido**, incorporada à mesma dotação de 10%, para o **indicador identificado, independente e verificado**, desde que também elegível e ativo nas mesmas 24 horas. Não se somam 5% ou quaisquer outros incentivos por fora. Na ausência de indicação qualificada, a parcela volta ao rateio geral: 10% da base líquida para os ativos.
- **Um pacote não pode ser remunerado duas vezes** nem gerar dois repasses em função de duplo clique, webhook repetido ou execução da rotina diária. A bonificação comercial da revenda é creditada ao indicador, não ao comprador do próprio pacote.
- **Nenhuma remuneração por simples cadastro ou recrutamento.** O fato econômico é o pagamento conciliado do pacote de taxa reduzida vinculado a empresa/motorista real e elegível.
- A oferta de taxa menor e o crédito pré-pago continuam exatamente como estão. O TAMÃO passa a **planejar** os 10% como despesa de aquisição/recorrência dos próprios recebimentos.

## Contabilidade: dinheiro que entra vs receita apropriada

Os planos pré-pagos atuais concedem créditos de taxas em geral no mesmo valor do Pix. Por exemplo, receber **R$ 49,90** e creditar **R$ 49,90** para taxas futuras é receber antecipadamente uma obrigação de prestar o serviço. Não é automaticamente lucro disponível no ato do Pix.

**Fluxo alvo seguro:** pagamento aprovado e liquidado → conciliação NET PSP → reservar até 10% em passivo exclusivo da Rede, mostrar *em apuração* → somente consolidar como recompensa disponível na medida em que o serviço/taxa do pacote seja apropriado ou haja reserva econômica verificável para a obrigação e para eventuais devoluções → maturação/estorno idempotente → transferência somente com beneficiário e provedor autenticados.

**Exemplo ilustrativo:** pacote de revenda de R$ 49,90, líquido de PSP hipotético R$ 49,70. O fundo máximo é **R$ 4,97**, dos quais **R$ 3,98** aproximadamente para a base ativa e **R$ 0,99** para o indicador da revenda se elegível. No motor exato, arredondamento ocorre em micr**o**centavos e não pode ultrapassar os R$ 4,97. O recebimento líquido **não** autoriza pagar os R$ 4,97 externamente antes da proteção contra estornos e demais obrigações.

## Elegibilidade da atividade

- A prova deve vir de sessão autenticada **e atividade real confirmada pelo servidor** dentro das 24h; ter uma aba aberta ou executar um token refresh não prova participação.
- Um usuário conta uma única vez por ciclo, mesmo que possua múltiplas sessões, navegadores ou recargas.
- Somente conta real com identidade verificada; excluir anonimato, conta bloqueada, equipe administrativa, autopagamento e fraude/autoindicação. Consultar também restrições reais de um mesmo beneficiário com muitas contas.
- Contagens de visitas e eventos de atividade não podem ser utilizadas para forjar a própria elegibilidade nem gerar crédito sem fonte financeira.
- **Se não houver venda conciliada**, não há novo fundo; se houver muitos elegíveis e poucos centavos, frações acumulam até alcançar centavos inteiros. Nunca prometer que cada pessoa verá ganho monetário diariamente.
- Participação não depende de compras pessoais ou de comprar pacote. Evitar pressão artificial, sorteios ou regras que tornem o benefício enganoso.

## Entrega presente: política testável, dinheiro inativo

A versão inicial inclui **somente** o algoritmo determinístico [`network-fee-package-pool-policy.mjs`](../../supabase/functions/_shared/network-fee-package-pool-policy.mjs) e o [teste](../../tests/network-fee-package-pool-policy-v1-493.mjs), vinculados à Auditoria da PR.

O algoritmo verifica: pacotes elegíveis, net verdadeiro e liquidado, 10%, 8%+2% sem duplicação, 24h verificadas, exclusão de contas não elegíveis, fontes repetidas, estornos e conservação dos centavos em micros. **Não toca banco nem carteira, não concede bônus, não habilita saques nem altera `commerce_enabled`**.

### Implementações obrigatórias antes da ativação

1. Identificar e registrar as fontes canônicas de cobrança e de consumo de crédito para revendas/mobilidade, com prova PSP e NET, referência de pacote e proteção contra repetição, estorno e cancelamento.
2. Criar trilha de atividade consentida e verificada por backend (não apenas `auth.sessions`), política antiabuso e identificação independente de cada participante.
3. Atribuir indicação de empresa ao CNPJ e seu titular real, sem autobenefício e com histórico imutável; registrar período de vigência e uma única fonte remunerável.
4. Criar passivo de fundo e razão financeira **apend-only** (origem, titular, fração, período, vencimento, maturação, correção, reversão, situação), reconciliável por PSP e por saldo; sem misturar `wallet_entries` de cashback e comissões de primeira compra.
5. Exibir no Cliente/Parceiro saldo *em apuração* e saldo *disponível* **somente das concessões reais**, com origem auditável, deduplicação e privacidade; assegurar arredondamento microcentavo → centavo e preservação do saldo residual.
6. Agendar fechamento diário idempotente pelo relógio de São Paulo, sem lançar parcelas fictícias quando não há receita, com desfazimento seguro após estorno; testar integração completa em Supabase descartável (Auth, Edge, PostgreSQL, Chrome).
7. Submeter a regras fiscais, de promoções, prevenção à fraude e ao prestador de pagamento antes de abrir saque monetário. O programa não deve depender de recrutar outras pessoas para obter valor.
8. Publicar somente após CI verde, reconciliação por fontes, segurança de funções e a verificação dos três portais; *não* usar dados de produção falsos para homologação.

**Status correto da frente #12:** política matemática implementada e coberta, **distribuição ainda não implementada**. Não anunciar "10% já distribuídos" antes de completar ledger/backend/UI e seus testes. Essa obrigação técnica não depende de ter clientes/revendas reais na operação.
