# TAMÃO V1.285 — recuperação operacional das revendas

## Incidente resolvido
Antes, `merchantRefresh()` colocava a operação em `unavailable` depois de um erro de transporte. O agendador global chamava `merchantPoll()` apenas quando `merchantReady()` estava verdadeiro. Resultado: uma falha temporária poderia interromper permanentemente as atualizações até uma ação manual.

## Mudanças
- Agendador passa a chamar `merchantPoll()` enquanto o **portal da revenda** está ativo; as verificações internas impedem consultas durante login, sem sessão, sem permissão ou durante operações em andamento.
- Quando `unavailable` e uma sessão de usuário permanece presente, o painel tenta recuperar com atrasos progressivos de 5, 10, 20, 40 e 60 segundos. Retorno bem-sucedido zera a contagem.
- Foco no navegador e evento de reconexão solicitam atualização imediata quando necessário, com limitação de chamadas repetidas.
- Abas ocultas continuam sem polling por padrão; com **alertas explicitamente ativados**, tentam polling em segundo plano com intervalo mínimo de 15 segundos. Temporizadores em segundo plano **não são garantidos** pelo navegador e nunca equivalem a push confiável com o app fechado.
- Saída da conta invalida respostas de atualização em voo via `refreshSeq`, evitando recuperar dados de uma sessão encerrada.
- No estado indisponível, a interface não apresenta ações de pedidos e informa corretamente a tentativa de recuperação. Botão manual continua disponível.

## Guardrails
- Não altera banco, Edge Functions, taxas, pagamentos, estoques, repasses, histórico ou transições de pedidos.
- Não cria pedidos, não aceita, não despacha e não conclui ações automaticamente.
- Não promete notificações enquanto o PWA está fechado.
- Teste novo `tests/merchant-recovery-v1-285.mjs` verifica falha e reconexão, backoff, estado sem sessão, concorrência, abas em segundo plano e impossibilidade de enviar ações.
- Teste V1.150 adaptado para conservar a política original de intervalos de 5/10/15/60 segundos no primeiro plano.

## Gates de publicação
Audit completo, Build, smoke móvel, merge e verificação do SHA da `main` nos portais oficiais. Testes com rede real e pedidos reais permanecem uma validação operacional separada.
