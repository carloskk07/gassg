# TAMÃO V1.162 — Consulta automática após CEP + número

## Problema de conversão
O cliente preenchia o CEP e número no pedido, mas precisava clicar em ‘Validar endereço’ para consultar as ofertas. Esse botão não agregava uma confirmação útil: o backend já era a autoridade final de validação e disponibilidade.

## Solução
- Inputs reais disparam atualização do estado enquanto a pessoa digita, sem apagar o campo nem reconstruir o formulário imediatamente.
- Com CEP de oito dígitos, número válido e cesta não vazia, aguarda 650 ms desde a última edição e dispara uma consulta de ofertas automaticamente.
- O agendador tem uma única janela por vez, ignora a mesma consulta enquanto estiver em andamento e evita chamadas iguais nos 20 segundos seguintes a um resultado bem-sucedido.
- A assinatura de deduplicação compreende CEP, número, cesta, forma de pagamento e janela de entrega. Mudar qualquer um exige nova prova do backend.
- Qualquer alteração de endereço invalida imediatamente a sequência de requisições, as ofertas, a confirmação postal e a evidência de cidade anteriores. Resposta tardia do endereço antigo é ignorada.
- A busca automática é silenciosa até receber a resposta, e o render final recupera foco e posição do cursor de quem ainda está digitando. Erros deixam botão ‘Tentar novamente’. Consulta manual continua disponível.
- Campo incompleto nunca abre cotação. Sair do checkout impede executar o timer anterior.
- O status descreve ‘consultando’ em vez de prometer a entrega: preço, estoque, rua, revenda e condições só são declarados quando retornam do servidor.

## Validações
Novo teste VM com timers determinísticos para digitação rápida e pausada, CEP inválido, request duplicado, timeout entre consultas, resposta tardia, reconsultar após falha, sair do checkout, preservação do número e do foco. Conserva auditoria existente e E2E em 320/360/390 px.

## Limites
Não houve alteração na validação do CEP pelo servidor, no fluxo de aceite da revenda, regras ANP, confirmação de pagamento, PIN, cobrança de taxa ou dados financeiros. Sem deploy nem migrações de produção. Ganho de conversão precisará de medição posterior por município.