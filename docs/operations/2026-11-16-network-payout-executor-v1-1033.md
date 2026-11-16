# TAMÃO V1.1033 — Execução segura e conciliação de Pix de saída da Rede

## Resultado de engenharia

O executor não cria nova carteira, não redistribui a remuneração da Rede e não mistura cashback, cupons, comissões diretas ou pacotes de outras modalidades. A origem do saque é **exclusivamente** a reserva V1.1031 de bonificações **elegíveis**, com controle contra uso duplicado no abatimento interno V1.1032.

O fluxo é composto por: identidade comprovada → chave Pix CPF protegida → reserva contábil → preparação → autorização individual → registro irretroativo de início de envio → `POST /v1/payouts` assinado → consulta oficial `GET` → comprovante bancário **independente** → confirmação de pagamento. Todos os estados são persistidos, privados e auditáveis.

**Não há transferência automática.** A UI separa preparar, autorizar e enviar. Não existe reenvio automático e todas as ações sensíveis exigem sessão atual de superadmin; somente um fluxo de execução explicitamente habilitado no banco e no servidor poderá enviar um Pix.

## Três barreiras para habilitar a execução real

1. **Programa ativo e termos aprovados**: `network_fee_package_policy_v1_1030.accrual_enabled=true` e referência válida aprovada. Esta entrega NÃO ativa a apuração.
2. **Credenciamento real do Mercado Pago Payouts**: credencial de produção e autorização da aplicação para `POST /v1/payouts`, chave pública Ed25519 registrada pelo provedor, privada somente em segredo de servidor. O token de recebimentos ou token de consulta Payouts **não é substituto** do token de escrita.
3. **Decisão explícita do proprietário**: `NETWORK_PAYOUT_LIVE_ENABLED=true`, `NETWORK_PAYOUT_MP_REGISTRATION_CONFIRMED=true` e `network_payout_execution_policy_v1_1033.execution_enabled=true`, com referência de autorização. Os três permanecem desligados/ausentes por padrão. Nenhuma transação real deve ser feita automaticamente após a implantação.

Variáveis de **servidor** da função `network-payout-ops`, nunca no browser:
- `NETWORK_PAYOUT_DATA_KEY_B64`: 32 bytes AES-256-GCM em Base64 para cifrar chave CPF Pix; não reutilizar com outras chaves.
- `NETWORK_PAYOUT_HASH_KEY_B64`: 32 bytes HMAC-SHA256 em Base64 para o identificador de Pix sem armazenar CPF em texto plano; guardar fora do repositório.
- `MERCADOPAGO_PAYOUTS_WRITE_ACCESS_TOKEN`: token de **produção**, emitido por uma aplicação Mercado Pago de Payouts autorizada para escrita; não reutilizar tokens de entrada nem consultar/renovar as credenciais existentes sem autorização.
- `MERCADOPAGO_PAYOUTS_ED25519_PRIVATE_KEY_PEM`: Ed25519 PKCS8 em formato PEM, correspondente à chave pública cadastrada no Mercado Pago.
- `MERCADOPAGO_PAYOUTS_READ_ACCESS_TOKEN` (opcional se token de escrita for utilizável para consulta): permite a conciliação `GET` mesmo após desligar novas saídas.
- `NETWORK_PAYOUT_MP_REGISTRATION_CONFIRMED` e `NETWORK_PAYOUT_LIVE_ENABLED`: ambos precisam ser exatamente `true` em produção, definidos apenas após homologação pelo proprietário.

A documentação do provedor exige o cabeçalho `X-Idempotency-Key`, `X-signature` com Ed25519 em Base64 e `X-enforce-signature:true` em produção; `POST /v1/payouts` aceita o lote, mas não prova crédito no destino. O código utiliza **apenas uma transação por lote**, com valor, moeda e `external_reference` estritamente vinculados ao banco.

## Segurança do beneficiário

Somente a chave Pix CPF é aceita nesta primeira versão, depois de comprovação independente de que CPF, identidade e conta pertencem ao beneficiário; chaves Pix aleatórias, telefones e e-mails não são suficientes para o vínculo esperado. O CPF não é armazenado em texto puro: o Edge cifra com AES-GCM, usa IV aleatório por registro e armazena uma impressão HMAC da chave. O registro do usuário exige arquivo de prova externa com hash SHA-256 e referência rastreável. O **arquivo não é carregado para o banco**; o responsável deve conservá-lo no dossiê auditável por fora da plataforma. Um hash sem o arquivo preservado não substitui a prova.

Não existem dados KYC oficiais no perfil TAMÃO que comprovem automaticamente a titularidade da chave. Portanto a identidade do beneficiário depende dessa conferência humana, mesmo com o software pronto. Nunca interpretar `user_id`, `email_confirmed_at`, um QR ou um campo de CPF digitado como validação independente de titularidade.

## Máquina de estados e contingências

- **prepared**: reserva e beneficiário conferidos; sem autorização nem Pix.
- **authorized**: autorização expressa do superadmin para valor e hash da chave.
- **dispatching**: estado persistido ANTES de qualquer `POST`; somente a primeira chamada poderá efetuar o envio. Se houver timeout ou falha, **NUNCA repetir POST** com outra chave.
- **uncertain**: o provedor pode ter recebido a ordem. Recuperação utiliza exclusivamente o `GET` oficial com IDs POP/TOP obtidos no painel do provedor e compatíveis com referência, valor e moeda; só depois esses IDs são vinculados. Não gera outro Pix.
- **submitted**: o Mercado Pago confirmou a recepção da ordem (202); **não** é pagamento.
- **credited_unverified**: GET mostra exatamente `success/accredited`, mas o pagamento ainda NÃO deve ser anunciado como liquidado porque identidade do destinatário depende de prova independente.
- **paid**: proprietário verificou extrato oficial, valor, beneficiário, banco e registro de referência/arquivo hash. Somente neste estágio é admitido exibir quitação comprovada.
- **rejected/refunded/review**: bloqueio contábil preservado; nenhuma reserva é automaticamente devolvida após tentativa externa. Refund após pago passa a revisão, não a saldo disponível.
- **cancelled**: somente preparação anterior ao despacho, com reserva cancelada de forma atômica.
- **Fonte de bonificação revertida**: gatilho coloca execução e reserva em revisão, sem apagar o histórico nem inventar um estorno.

## CI e evidência

- `node tests/network-payout-executor-contract-v1-1033.mjs`: vetores reais de validação de CPF, valor, corpo Pix, resposta de criação, consulta, campos divergentes, revisão, autorização e proteções de código.
- `tests/sql/network-payout-execution-v1-1033.sql`: PostgreSQL isolado com dados **inteiramente sintéticos** e `BEGIN; ROLLBACK;`, abrangendo permissões, estados, reserva, prova, duplicidade, cancelamento, timeout, recuperação GET e reversão. Nenhuma chamada à conta bancária/MP ocorre nesses testes.
- `scripts/audit-edge-functions.sh`: checagem Deno das Edge Functions, incluindo criptografia e dependências.

**Critério de encerramento técnico:** código, migração, teste isolado, publicação do Admin e Edge íntegros; autorização e primeira transação real são operações externas futuras e não devem ser rotuladas como falha de implementação. Isso **não** significa que a API já foi autorizada pelo Mercado Pago ou que qualquer beneficiário foi pago.
