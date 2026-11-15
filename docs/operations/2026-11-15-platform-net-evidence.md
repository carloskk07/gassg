# Central Financeira — conciliação líquida da plataforma

Continuação da main `af69c67829ded63e33edd1bca6d6ddb59219a48b` / PR #1006.
A contagem permanece **14/19 frentes encerradas; #2, #3, #4, #6 e #12 abertas**.
Esta entrega resolve a conciliação NET de planos/taxas, mobilidade e publicidade;
o encerramento comercial integral de #3 exige os fatos pendentes de consumo,
comissões/repasses e modalidades ainda sem cobrança real. Não mudar os aceites
para contar uma subpendência como frente encerrada.

## Comportamento implementado

O cron privado de relatórios já existente continua com o seu segredo e agenda.
Além do caminho canônico de cupons, seleciona até duas cobranças da plataforma,
consulta somente GET no Mercado Pago e compara:

- recebedor autenticado em `/users/me`;
- cobrança persistida, valor bruto, referência e Pix específico na Orders API;
- pagamento numérico na Payments API, conta recebedora, aprovação/liberação,
  moeda, valor líquido, estornos e vínculo à mesma order;
- CSV oficial descoberto pelo provedor, liberação única, valor bruto/líquido,
  data e ausência de movimentos correlacionados contraditórios, inclusive em
  outro arquivo do período.

Publicidade usa a Payments API e o pagamento persistido da campanha. Vendas
recebidas pelas revendas são excluídas: pertencem ao vendedor. Nenhuma consulta
prova saque bancário, lucro ou saldo atual da conta do proprietário.

O relatório, hash SHA-256, pagamento e valor liberado ficam em evidência
imutável, sem dar crédito, habilitar vendas ou mover dinheiro. Uma repetição
idêntica não duplica liberação; prova contraditória abre revisão sem apagar a
original. A leitura sempre considera o estado atual do negócio: um estorno
retira o valor dos totais conferidos e preserva a liberação histórica.

## Admin e operação

Na Central Financeira existente, o histórico reúne planos/taxas, cupons,
motoristas e publicidade, com totais do banco completo e até 30 comprovantes
recentes claramente identificados. Os totais não são calculados pela amostra.
A evidência original dos cupons é reaproveitada; não se cria outro motor de
financiamento nem se reativam os três vouchers já estornados.

Somente os papéis Financeiro/superadmin alcançam o readback pelo gateway.
Tabelas com RLS e funções internas são inacessíveis a anon/authenticated.
O service role lê a projeção e grava exclusivamente pela RPC de evidência.
A inspeção privada exige o mesmo token de máquina e não persiste nada.

A agenda verifica divergências a cada 30 minutos, ou revisita evidências
confirmadas a cada seis horas. Na revisita, o arquivo original e seu hash
são relidos com os fatos atuais do PSP: o crescimento do histórico diário
da conta não impede a conferência de uma liberação antiga. Falha de rede/relatório fica pendente, sem
confirmação falsa. Não exige novo Pix do proprietário nem outra revenda.

## Verificação exigida para considerar entregue

1. `platform-net-evidence.mjs`: dados divergentes, recebedor, valor, Orders,
   Payments, estornos em arquivos diferentes, inspeção sem escrita e UI.
2. Integração isolada: schema completo, fontes reais dos cenários canônicos,
   registro/repetição/conflito, auditoria imutável, RLS, reversão Ads e ROLLBACK.
   Todo dinheiro/evidência nessa integração é sintético.
3. Audit, integração e revisão visual aprovadas no HEAD exato.
4. Migração aplicada, bundles `coupon-net-auto` e `admin-ops` preservados e
   relidos, evidência dos recebimentos existentes consultada no provedor.
5. Portais publicados no mesmo SHA e situação final registrada na PR/issue #493.

Nenhum gate de publicação/recebimento acima é afirmado antes de acontecer.
A PR e o ponto de continuidade da issue registram os resultados observados.
