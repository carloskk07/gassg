# TAMÃO V1.238 — Da primeira parceria à primeira venda

## O problema que os dados mostram

O maior gargalo atual não é a falta de um produto publicitário:
é a ausência de revendas efetivamente cadastradas e transacionando.
Na consulta à base oficial em 13/10/2026 foram encontrados:

| Origem | Situação no momento da análise |
|---|---:|
| Prospectos GLP na base ANP/CRM | 17 |
| Prospectos ANP sem contato registrado | 17 |
| Convites ANP emitidos | 0 |
| Leads interessados em revenda | 0 |
| Solicitações de cadastro de revenda | 0 |
| Revendas cadastradas | 0 |
| Revendas com interesse em Ads | 0 |

Esses números são fotografia do momento, não seed ou constantes do sistema.
Fontes públicas, autorização e habilitação comercial exigem conferência:
**um registro ANP não é um parceiro ativo ou convite para comercializar.**

## Implementação

**Admin → painel de Aquisição e crescimento → Ativação comercial:**

- Contadores independentes por etapa operacional (ANP CRM, convites válidos e
  aceitos, leads de revenda, solicitações pendentes, empresas ativas, empresas
  online, interesse Ads e criativos revisados).
- Agrupamento por cidade **apenas dos prospectos ANP** — não inferir localização
  do cliente, cobertura das revendas, cidade dos anúncios ou atribuição de vendas.
- Próxima ação sugerida pela situação atual, com acesso ao módulo de
  Prospectos, Parceiros ou Visão Geral que já existe no Admin.
- Sem executar contato por WhatsApp, enviar convites, gravar CRM, criar
  empresas, alterar dinheiro ou modificar regras de elegibilidade.
- Apenas métricas agregadas acessíveis via Edge Function autenticada e
  função privada SQL com defesa de autorização e fachada EXECUTE service_role.
- Os conjuntos podem se sobrepor ou divergir; **não calcular taxa de
  conversão pela divisão direta dos totais** sem atribuição confiável.

## Processo prático para obter a primeira receita

1. **Confirmar e priorizar os prospectos reais do CRM**: conferir se ANP,
   empresa, autorização e localização estão atuais. Evitar contato duplicado.
2. **Primeiro contato humano**: apresentar o TAMÃO como canal adicional de
   pedidos sem assinatura obrigatória. Registrar canal, status e próxima data.
3. **Convite consentido**: se a empresa demonstrar interesse, usar o fluxo
   existente para convidar a revenda. Não emitir convite automaticamente.
4. **Cadastro e validação**: proprietário solicita conta; Admin verifica
   identidade/autorização e libera os recursos que forem permitidos.
5. **Operação real**: definir estoque, catálogo, preços, entregas, pagamentos,
   horários/heartbeat e aprovação, sem fingir disponibilidade.
6. **Pedidos e receita**: primeiro pedido legítimo liquidado e taxa própria
   TAMÃO conciliada. Crédito usado para quitar taxas não é receita adicional.
7. **TAMÃO Ads**: somente depois, oferecer registro voluntário de interesse,
   campanha e diagnóstico. Publicidade continua sem veiculação pública/pagamento.

## Critérios de próxima evolução

- Base com ao menos uma revenda real apta a entregar pedidos, sem simulações
  de cadastro ou receita.
- Primeiro evento de contato real registrado no CRM por operador autorizado.
- Análise de funil individual apenas quando existir consentimento e vínculo
  operacional confiável (não inferir de agregados).
- Validar compras reais e privacidade antes da cobrança de produtos Pro/Ads.
- Qualquer cobrança adicional e campanha patrocinada permanecem bloqueadas
  até entrega real e contratos separados.

**Regra central:** sem inventar clientes, revendas, anúncios, propostas,
contatos, transações ou conversões apenas para deixar painéis preenchidos.
