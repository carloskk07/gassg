# TAMÃO — fechamento comercial por módulos (V1.914)

Base: issue #493, continuação da V1.913, branch `main`. Observações somente-leitura do banco comercial em **09/11/2026**; NÃO são testes de vendas reais.

## Decisão de escopo — Hospedagens

O proprietário solicitou **suspender hospedagens por enquanto** e dedicar esforços aos demais módulos. Foi aplicada alteração de operação no Supabase comercial: `discovery_vertical_cities`, modalidade `stays`, São Gabriel/RS, `enabled=false`, com motivo de manutenção e data na própria linha. Não havia qualquer anúncio de hospedagens. Nenhuma tabela, histórico, cadastro, documento ou valor financeiro foi apagado. `rides` e `professionals` permanecem habilitados em São Gabriel.

Na V1.914: ocultar entradas na home, no índice de serviços e na seleção de novos anúncios; endereço direto `/#stays` informa a suspensão; as páginas PT/es-AR de hospedagem permanecem acessíveis com **noindex**, sem chamar o cadastro/consulta, e deixam de integrar o sitemap público. Códigos de integração futura ficam preservados. NÃO declarar reservas nem comissões como ativas.

## Inventário comercial real (snapshot 09/11/2026)

| Módulo | Estado observado | Fechamento necessário antes de prometer operação real |
|---|---|---|
| Revendas e pedidos de produtos | 1 revenda `pending`; 1 candidatura `approved`; 0 pedidos no banco comercial | Confirmar elegibilidade real da revenda, estoque, preço, entregas e pagamento na entrega; executar fluxo real auditável sem criar vendas fictícias nem forçar ativação |
| Clube — cupons universais | Modalidade `all_products_3x5_sponsor` com pacote `sale_enabled=true` e liberação comercial `enabled=true`; 0 faturas reais | Preservar liberação legítima e provas; conferir checkout real, webhooks, direitos de cancelamento, benefício aplicado e compromissos com revendas. Zero faturas não equivale a checkout validado por comprador real |
| Publicidade independente | 0 campanhas; `sales_enabled=false` e `delivery_enabled=false` | Concluir identidade do recebedor, testes de campanha/checkout/reconciliação, política de revisão e entrega mensurável; **não** ligar cobrança automaticamente ou inventar inventário publicitário |
| Moto e carro | 0 solicitações de mobilidade reais | Homologar solicitação, aceitação, acompanhamento, preço informado, finalização e cobrança de taxa apenas após comprovação do evento, respeitando autorização e plano do profissional |
| Profissionais | 0 anúncios de `discovery_listings` | Oferta cadastrável e moderada; contato direto sem falsa garantia de prestação ou pagamento |
| Caronas | 0 anúncios; cidade habilitada; sem pagamentos ou reservas na plataforma | Manter caronas ocasionais gratuitas. Não inventar atividade profissional a partir de 5 anúncios, nem cobrar comissão sem confirmação verificável de prestação/adequação legal |
| Hospedagens | Cidade desligada; 0 anúncios | **Pausado** por decisão do proprietário, sem fornecedor externo, reserva, comissão ou assinatura a contratar |

## Sequência de execução para o ciclo seguinte

1. **Sem riscos comerciais:** fechar telas e atalhos pendentes no Cliente, Parceiro e Admin; remover apenas fluxos de aquisição pausados; preservar dados e direitos.
2. **Revenda → cliente:** validar o conjunto mínimo de preço, estoque, CEP, emissão de pedido, confirmação, entrega e histórico; evidência verificável em PostgreSQL descartável/Chromium, separando testes de transações reais.
3. **Clube:** demonstrar o estado comercial atual com faturas, eventos provedor/conciliador, uso e estorno; não trocar flags por supostas evidências.
4. **Publicidade independente:** só habilitar venda e entrega se os controles de provedor, recebedor, aprovação, impression tracking e devoluções exigidos pelo backend estiverem comprovados.
5. **Mobilidade:** validar ponta a ponta as solicitações com motorista aderente, sem gerar comissões nem receitas antes de confirmação verificável.
6. **Caronas e profissionais:** manter gratuitos enquanto forem vitrine/contato direto; eventual monetização profissional requer modelo jurídico separado e prova de serviço.

## Invariantes obrigatórios

- Nenhum dado sintético, comprovante sem lastro, venda, Pix, saldo, reembolso, campanha ou pacote pode ser criado/ativado no banco comercial para 'concluir' um checklist.
- Nenhuma verificação de código/CI pode ser apresentada como substituta de cobrança/recebimento efetivo do PSP em produção.
- Backups, RLS, controle de cidades, consentimento de programa e proteção contra pagamentos duplicados permanecem preservados.
- Progresso medido pela existência de fluxo demonstrável e evidência, não apenas pelo número de módulos ou telas.
