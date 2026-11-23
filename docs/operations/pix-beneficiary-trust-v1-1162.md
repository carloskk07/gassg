# TAMÃO V1.1162 — identificação de confiança para cobranças Pix

## Finalidade

A identificação de responsabilidade é exibida **junto à cobrança Pix realmente pagável**, antes do QR Code e do Pix Copia e Cola. Ela não altera o BR Code, o valor, a chave, o recebedor efetivo, o PSP, o webhook nem a conciliação.

Para cobranças feitas pelo TAMÃO, a referência administrativa escolhida pelo responsável é:

- **RESPONSÁVEL TÉCNICO TAMÃO**
- **Carlos Alberto dos Santos Freitas**
- Responsável indicado pelo TAMÃO para a operação de recebimento
- Cobrança gerada pelo sistema oficial do TAMÃO

O painel **não** apresenta essa identificação como prova da titularidade da conta do Pix. O usuário deve comparar o titular/CPF mascarado realmente apresentado no aplicativo bancário antes de pagar. Divergências exigem interromper o pagamento e procurar o suporte. **Nenhum dígito de CPF é extraído de metadados não validados, presumido ou publicado pela interface.**

A identificação pessoal do responsável não é exibida nas cobranças de produtos cujo dinheiro vai diretamente para revendas, nem é atribuída a vendedores parceiros de pacotes do Clube. Esses fluxos exibem respectivamente **RECEBIMENTO DIRETO À REVENDA** e **VENDEDOR DO PACOTE**, com o nome real quando presente no registro de pagamento.

## Escopo visual

- Cliente: Pix do pedido quando `onlinePayment.pixPayable===true`; compra de cupons no Clube com prazo de visibilidade e comprovação da região; Ads com recarga válida; taxas de mobilidade com cobrança ativa.
- Parceiro: Pix de pacote/taxas/correção com prova vigente do pedido.
- Admin: Pix real de operações financeiras e homologação de créditos, somente quando já emitido e pagável.

Pagamentos concluídos, cancelados, expirados, escondidos por troca de conta, sem integridade e cobranças externas Checkout Pro não recebem um QR/identificação falsa.

## Limites atuais

- O cadastro de vendedor do Clube e o nome fornecido pelo responsável podem variar em partículas do nome. Não é permitido declarar equivalência automática com a titularidade bancária.
- A versão **não** fornece os dois dígitos finais do CPF porque não há uma prova bancária reutilizável, vinculada a todas as rotas de PSP da plataforma. A ocultação continua intencional; não usar dados salvos no navegador como atestado.
- Após a ativação futura e comprovada de pessoa jurídica, rever a apresentação PF e utilizar o CNPJ/razão social oficiais do recebedor. A presente alteração não antecipa a virada PF→PJ.

## Verificações

`node tests/pix-operator-identity-v1-1162.mjs` executa testes de isolamento entre recebedor da plataforma, revenda e vendedor de pacote, sanitização XSS, CPF não divulgado, condições de exibição de Pix e segurança de scripts. A auditoria dos portais, E2E visual, build e integração financeira seguem independentes.
