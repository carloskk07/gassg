# Clube TAMÃO V1.240 — interesse voluntário de revendas

Status: pesquisa privada de patrocínio; **sem contrato, venda, emissão, resgate, cobrança ou desconto**.

## Funcionalidades
- No painel de revenda, apenas proprietário/gerente pode consultar, registrar, atualizar ou retirar o interesse por Clube Gás e Clube Água.
- Opções de 25%, 50% ou 100% do desconto, combinadas com teto ilustrativo de R$ 30, R$ 100, R$ 300 ou R$ 1.000; não reservam verba.
- Cidade/UF são capturadas diretamente de `merchant_business_details`, não enviadas pelo usuário.
- Consentimento explícito para registrar **preferência comercial**; a negociação será separada, sem aceite vinculante de patrocínio.
- Propostas versionadas por `(merchant_id,package_key)`, escrita com conferência da versão atual e idempotência por UUID; histórico imutável de tentativas de mudança.
- No Admin > Aquisição, fila somente de propostas atuais, até 50 registros. Sem dados de contato ou afirmação de orçamento financiado.

## Segurança
- RLS + REVOKE públicos. Tabelas sem acesso de escrita via Data API, mesmo `service_role`.
- Função privilegiada em schema privado exige `merchant_members.active` + papel owner/manager e valida qualquer operação.
- A Edge `merchant-ops` revalida autenticação/papel, campos e invariantes no retorno. A Edge `admin-ops` só libera a fila a Admin autorizado.
- `discount_enabled`, `funding_verified` e `sponsor_contract_approved` estão **forçados a false por CHECK**.
- Nenhum join de pedidos, carteiras, comissão ou pagamentos é alterado. Campanhas e cupons continuam desligados.

## Próximas etapas para operação real
1. Coletar intenção de revendas efetivamente cadastradas.
2. Projetar contrato de patrocínio por cidade/pacote, condição de cancelamento e tratamento dos cupons vendidos.
3. Estabelecer prova de financiamento, orçamento comprometido e razão contábil, inclusive passivo dos benefícios emitidos e não usados.
4. Construir cota autorizada por revenda, regras por SKU e reserva transacional, sem gastar acima do teto.
5. Integrar ao checkout com confirmação de revenda e pagamento: falha fecha o acesso ao benefício.
6. Somente então abrir pacotes ao público mediante liberação financeira/jurídica explícita e ensaios E2E.

Nota: teto de intenção não é orçamento contratado, nem há autorização para revenda sofrer descontos automaticamente.
