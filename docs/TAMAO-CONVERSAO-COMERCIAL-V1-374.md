# TAMÃO V1.374 — Conversão comercial com menos etapas

Data: 17/10/2026.

## Diagnóstico
A página da revenda apresentava cartões, trilho de navegação, etapas e detalhes de economia antes do formulário de interesse. O visitante precisava percorrer a página, apesar de o botão do hero levar ao formulário. CEP e observações eram opcionais, mas ficavam expostos como se integrassem a etapa obrigatória.

A página dos patrocinadores já tinha propostas de campanha e contato por objetivo, porém a escolha do tipo de proposta aparecia após a primeira apresentação. Os três passos do hero repetiam instruções em vez de apresentar escolhas comerciais acionáveis.

## Entregas
- **Revenda:** formulário real movido para imediatamente depois do hero, com introdução orientada ao preenchimento e 3 passos visuais. A seção agora contém o mesmo formulário `prelaunchMerchantLeadSection()`, executado uma única vez.
- **Formulário:** nome da empresa, nome do responsável, WhatsApp, categorias vendidas e consentimento continuam visíveis e obrigatórios pela validação já existente. Somente CEP e observações, que eram opcionais, ficam dentro de um `details` HTML nativo, acessível por teclado e sem dependência de script.
- **Patrocinador:** três objetivos claros aparecem na apresentação principal: presença de marca, benefícios para clientes e ação com revendas. Cada botão utiliza `openSponsorContact` com o formato atual e mensagem predefinida, preservando texto já preenchido pelo usuário.
- **Responsividade:** cartões com alvo de toque confortável, formulário visualmente separado, contraste e foco acessíveis, adaptação para 320–390 pixels e respeito a preferência por movimento reduzido.

## Limites preservados
- O interesse de revenda não ativa a cidade, não cria pedido, não habilita pagamentos e não autoriza comercialmente uma empresa.
- `submitPrelaunchMerchantLead()` mantém validação de empresa, responsável, WhatsApp, categoria e consentimento, além de proteção anti-spam e envio à mesma Edge Function.
- A publicidade é identificada; nenhum investimento, alcance, resultado, pagamento ou campanha é criado pelos botões de intenção.
- As regras de taxas atuais, disponibilidade de produtos, preços, recebimento, cashback, comissões e autorização do administrador principal não mudaram.
- A oportunidade de melhoria de conversão é hipótese de design: não divulgar crescimento de CTR ou leads sem dados reais.

## Validação
`tests/commercial-entry-v1-374.mjs` verifica os novos caminhos de cadastro e patrocínio, campos obrigatórios, detalhes opcionais, apresentação não enganosa, CSS mobile e foco. Requer também auditoria completa, build dos portais e testes mobile existentes. Integração de PR e publicação Cloudflare são etapas distintas.
