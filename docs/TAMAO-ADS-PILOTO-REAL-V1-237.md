# TAMÃO Ads — Primeiro piloto operacional (V1.237)

**Estado:** preparação técnica e qualificação somente. Nenhuma campanha pública, impression faturável ou receita Ads.

## O que foi implementado

No Admin → Aquisição → Central de propostas, use **Conferir requisitos** na proposta específica.
A checagem usa exclusivamente dados de produção da própria revenda e retorna
sinais verificáveis, sem criar pedidos, anúncios, clientes, campanhas, valores
financeiros ou dados fictícios.

As condições examinadas são:

1. Proposta existente com revisão de conformidade e identidade do revisor
2. Interesse comercial voluntário da revenda ainda ativo
3. Revenda ativa e online
4. Local da campanha idêntico ao cadastro oficial da revenda
5. **Elegibilidade na mesma função de ofertas reais:** `market_city_offer_scope`
   (não uma simulação mais permissiva)
6. Produto ativo na categoria da campanha, com estoque, preço recente e
   conformidade da categoria
7. Prévia interna da versão atual relatada pelo navegador — **não** é
   uma impressão independente nem prova de visualização humana
8. Exibição pública bloqueada
9. Cobrança bloqueada
10. Medição faturável bloqueada

A resposta contém `internalPrerequisitesMet`, que apenas significa que as
verificações internas listadas estão completas. **Não significa**
que podemos veicular anúncios ou faturar publicidade. A tela não expõe nome,
telefone, endereço ou identificação de clientes e não lê eventos individuais.

## Evidências ainda exigidas para o primeiro anúncio real

- Revenda real ativa, com peça verdadeira revisada e consentimento vigente
- Comprador real consultando ofertas genuínas e sem interferência publicitária
- Atendimento da cidade real e elegibilidade de estoque/preço/pagamento
- Prova independente de que a publicidade foi efetivamente renderizada ao
  público na área separada e identificada como Patrocinado
- Resiliência a repetições, bots, eventos inventados e múltiplas sessões
- Política de finalidade, transparência e retenção LGPD validada
- Acesso e cancelamento administrativo, kill switch e auditoria de exceções
- Contrato, cobrança conciliável, estorno e contestação separados dos
  pagamentos de produtos e do crédito de taxas do TAMÃO
- Aprovação operacional explícita após comparação entre exibição, audiência
  da cidade e reclamações reais

Até esses itens serem comprovados, **readyToSell=false**, publicidade
pública desativada e receita de anúncios igual a zero.

## Próxima ação quando uma revenda real entrar

1. Revenda ativa cadastra o interesse Ads e salva sua peça verdadeira
2. Envia a proposta; Admin/Conformidade confere categoria, texto e legitimidade
3. Conformidade revisa apenas a peça e realiza prévia interna
4. Administração executa **Conferir requisitos** e corrige pendências
5. QA testa aquisição de ofertas, checkout e integridade do ranking orgânico
6. Somente uma versão posterior, especificamente auditada, poderá propor
   disponibilizar uma campanha pública *gratuita* controlada
7. Cobrança fica separadamente bloqueada até comprovação de alcance e faturamento

Não inserir registros artificiais na base de produção para simular a operação.
A ausência de revendas ou audiência legítima aparece como falta de evidências,
e nunca como resultado positivo.
