# TAMÃO V1.380 — Checkout sem cortes silenciosos de dados

17/10/2026

## Problema

A edição do endereço de entrega aceitava o CEP digitado no campo após remover caracteres de formatação, mas então fazia `.slice(0,8)` antes de validar. Um CEP de nove números poderia ser transformado em outro de oito dígitos, levando o visitante a consultar a região errada. A mesma lógica truncava números de endereço extensos. A cópia do valor para a caixa após rerender também ocultava dígitos excedentes.

O telefone do cliente tinha truncamento semelhante antes de ser validado. Mensagens de endereço e contato eram gerais e, na correção de alguns erros, apareciam apenas como notificações passageiras.

## Alterações

- Leitura **integral** do CEP, número da residência e telefone antes da validação, sem truncamento silencioso.
- Campo com número inválido mantém o texto original para revisão. Uma entrada de nove dígitos não é aceita como CEP de oito.
- Mensagens ao lado de CEP e número explicam qual o próximo dado necessário. O estado inválido fica identificado com `aria-invalid`; `aria-describedby` vincula as entradas ao status.
- Erros no comando manual **Consultar endereço** anunciam a causa e colocam o foco no campo correspondente.
- Consulta automática, já protegida por debounce e prova do servidor, continua ocorrendo apenas quando o CEP contém exatamente oito números, o número da residência é válido, existe uma cesta e o serviço está pronto.
- O contato da entrega recebe mensagem de erro junto ao campo, com foco e rejeição de dígitos excedentes no envio.
- Layout mobile reforçado com áreas de toque confortáveis e feedback de teclado nas resoluções pequenas.

## Proteções preservadas

Mudanças limitadas ao formulário público de compra, estilos e testes. Nenhum endpoint, regra de comissão, autorização comercial, ativação de cidade, desconto ou pagamento foi alterado. O backend continua responsável pela confirmação do CEP, região, preços, ofertas, aceite da revenda e criação real dos pedidos.

## Testes e publicação

- `tests/checkout-address-clarity-v1-380.mjs`: CEP de 9 dígitos, endereço extenso, correção de campos, limpeza de cotações antigas, CEP e número válidos, estado offline, cesta vazia, telefone longo, mensagens acessíveis e classes mobile.
- Atualização do fixture `tests/auto-address-lookup-v1-162.mjs` para executar o novo auxiliar de mensagens junto ao comportamento original de invalidação, debounce e rejeição de respostas antigas.
- Executar Audit completo e construção isolada dos três portais antes de integrar. Confirmar o SHA em publicação Cloudflare separadamente.

Nenhum aumento de taxa de conversão é declarado sem mensuração posterior.
