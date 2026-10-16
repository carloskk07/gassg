# TAMÃO V1.315 — Localização de pagamentos Ads pela referência externa

## Mudança operacional

Na central **Admin → Ativações → Mercado Pago exclusivo do TAMÃO Ads**, o fundador pode escolher **Localizar e conciliar automaticamente**, sem precisar copiar o ID numérico do pagamento. O caminho anterior **Conferir pelo ID do pagamento** permanece disponível como alternativa para casos ambíguos.

O novo comando `ads-psp-discover` **não faz nenhuma escrita no banco e nunca marca um pagamento como recebido**. Ele:
1. Exige sessão autenticada, papel superadmin e configuração explícita `ADS_MP_CHECKOUT_ENABLED=true` com `ADS_MP_ACCESS_TOKEN` e `ADS_MP_SELLER_ID` exclusivos da plataforma.
2. Verifica a conta recebedora por consulta autenticada `GET https://api.mercadolibre.com/users/me` e compara o ID da conta com o seller autorizado no servidor.
3. Lê uma cobrança Ads existente no registro privado e apenas permite consulta se o checkout estiver `checkout_ready` ou `payment_approved`.
4. Para checkout pendente, usa `GET /v1/payments/search?external_reference=...` (limite 50, paginação explícita, ordenação por atualização), conforme a [documentação oficial Mercado Pago](https://www.mercadopago.com.br/developers/pt/docs/subscriptions/additional-content/payment-management). Se nenhum registro é encontrado, declara **não encontrado nesta consulta**, jamais "não pago". Se mais de um registro corresponde à referência ou se a resposta é inválida, exige conferência manual.
5. Para candidato único, consulta novamente `GET /v1/payments/{id}` e exige ID, conta recebedora, referência, moeda BRL e valor integral **idênticos** ao checkout.
6. Para um pagamento anteriormente aprovado, consulta diretamente o ID armazenado para verificar se existe reembolso, contestação ou aprovação ainda vigente.

Os resultados `approval_candidate` ou `reversal_candidate` apenas sugerem uma transição. O fundador precisa confirmar; então o painel usa a ação `ads-psp-action` V1.314, que executa **outra consulta ao provedor** e valida a prova em uma transação SQL com versão e idempotência antes de atualizar qualquer estado financeiro. O painel exige leitura posterior para mostrar sucesso.

## Condições que bloqueiam mudança financeira

- Nenhuma resposta ou indisponibilidade do provedor → nenhuma conclusão.
- Resultado paginado/inconsistente ou múltiplos pagamentos → conferência manual.
- Estado pendente, valor incorreto, referência divergente, moeda diferente, conta recebedora distinta → não aprova.
- Status `approved/accredited` só pode passar a `payment_approved` após confirmação individual e transação V1.314.
- `refunded`, `charged_back` ou `partially_refunded` seguem as proteções já existentes na V1.314.1 e não são ignorados.
- Sem configuração de credenciais próprias, a consulta permanece desativada.
- Nenhuma preferência nova, Pix, boleto, fatura, estorno externo ou publicação de anúncio é criada pela nova consulta.
- A API Payment Search lista pagamentos dentro da janela temporal suportada pelo provedor (documentação atual menciona os últimos 12 meses). Ausência em uma consulta não comprova ausência de pagamento em períodos anteriores.

## Implantação e testes

Alterações apenas em `supabase/functions/admin-ops/index.ts`, `js/admin-activations.js`, testes e documentação. **Não há migração de banco na V1.315**. Reutiliza as RPCs com RLS e proteção dupla já publicadas. O teste `tests/ads-psp-discovery-v1-315.mjs` confirma que busca isolada não escreve estado e que a conciliação segue uma nova verificação.

Nenhuma cobrança, pagamento ou preferência fictícia é criada ao publicar.
