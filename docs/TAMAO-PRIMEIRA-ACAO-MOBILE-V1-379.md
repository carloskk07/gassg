# TAMÃO V1.379 — Menos atrito no celular

Data: 17/10/2026.

## Diagnóstico reproduzível

A home da V1.378 permite preencher opcionalmente o CEP e selecionar um produto tocando na ilustração ou na vitrine. Esses botões usavam `quickProduct`, que seleciona uma cesta e navega para pedidos, mas não recolhe o CEP digitado na home. O CTA genérico preservava o CEP, criando comportamento inconsistente. A mesma rotina genérica truncava para oito dígitos um CEP digitado com nove números, aceitando silenciosamente uma entrada incorreta.

No formulário público de revenda, erros de nome, WhatsApp, categorias, CEP opcional e consentimento apareciam apenas como mensagens passageiras, sem identificar o campo nem facilitar a correção com teclado ou no celular.

## Solução entregue

- Novo `homeChooseProduct(code)`: válido apenas para produtos existentes e visíveis; lê o CEP opcional da home, rejeita números incompletos ou longos, preserva o endereço previamente validado se o CEP não mudou, e limpa rua, número, ofertas e certificação de disponibilidade quando muda. Só depois transmite a escolha explícita para a rotina `quickProduct`.
- Os cards da vitrine inicial, a composição de produtos do hero e os cards da seção secundária passam pela mesma rotina. A escolha de água não inclui gás por padrão.
- `startHomeOrder` passa a validar o CEP integral, evitando truncamento silencioso.
- O cadastro comercial exibe mensagem junto ao campo inválido, marca `aria-invalid`, associa `aria-describedby`, inclui anúncio por `role=alert`, foca o campo e expande o bloco de informações opcionais quando necessário.
- A seleção de categorias torna-se focável via teclado em caso de erro e os campos ficam mais confortáveis em telas pequenas. O CSS mantém estado visível de foco, erro e acessibilidade.

## Regras preservadas

Não há consulta de preços, autorização de cidades ou disparo de pedidos pelos novos botões. A oferta, o estoque, a aceitação de pedido, a escolha comercial da revenda e o pagamento continuam no backend atual. O envio de interesse segue `prelaunchLeadSubmit`, inclusive consentimento, deduplicação e proteções existentes. A interface não simula revendas nem promete cobertura.

## Verificação

- `node tests/mobile-first-action-v1-379.mjs`: CEP completo, CEP inválido, CEP vazio, alteração de região e remoção de ofertas antigas, produto oculto, ambiente de teste, formatação de campos, foco, mensagens acessíveis e submissão protegida.
- Adaptados contratos legados de V1.373/V1.374, preservando o significado funcional.
- `Audit` com testes de navegador e `Build isolated live portals` devem concluir em sucesso antes da integração.
- A publicação efetiva dos três portais Cloudflare é comprovada separadamente por workflow com SHA da `main`.

O resultado esperado é menor abandono por campo incorreto e transição clara da vitrine à consulta, mas não deve ser anunciado como aumento comprovado de conversão sem dados reais.
