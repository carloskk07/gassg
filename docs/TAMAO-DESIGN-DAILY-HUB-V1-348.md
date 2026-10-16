# TAMÃO V1.348 — Central do Dia e Rede TAMÃO

Data: 16/10/2026

## Diagnóstico especialista
O TAMÃO tinha muitos módulos operacionais e uma primeira dobra da revenda com quatro atalhos pouco diferenciados. A operação precisava enxergar de imediato: situação e próximo passo, pedidos atribuídos e caminhos de trabalho disponíveis para seu perfil.

A página da Rede TAMÃO apresentava vantagens, mas o percurso de convite e acompanhamento competia visualmente com um menu de opções sem hierarquia editorial.

## Evoluções
- Novo **resumo de orientação** no cabeçalho do painel da revenda, com caminho seguro para pedidos, situação operacional, preparação ou área financeira, segundo dados e papel informados pelo backend. Nenhum comando é executado automaticamente.
- Prioridade para pedidos já atribuídos, mesmo que haja restrição financeira de novas vendas. Sem pedidos: pendência financeira, requisitos de habilitação, estado offline, conexão e manutenção, nesta ordem.
- Atalhos de operação reorganizados em Pedidos, Produtos e entregas, Resultados (proprietário/gerência), Divulgar e indicar (proprietário/gerência), Minha revenda. Omitir o link para Resultados de operador **não substitui autorização do servidor**.
- Resumo de quantidade de pedidos, nome da revenda e estado de presença mais legíveis. "ONLINE" é um status de configuração/heartbeat, **não garantia de disponibilidade comercial**.
- Atalhos roláveis e acessíveis por teclado; ao escolher Pedidos, o título da fila pode receber foco. Disclosures conservam a abertura e o foco existentes.
- Página da Rede TAMÃO com proposta de valor no topo, área editorial ilustrativa e dois botões de ação (rede e benefícios), sem números fictícios, falsas avaliações ou promessas de renda.
- Tokens de layout e responsividade mobile, com mídia de redução de movimento.

## Segurança e limites
- Nenhuma migração, Edge Function, política comercial, abertura de cidade, permissão, PSP, taxa, recompensa ou transação modificada.
- A orientação é renderização do estado lido, não tentativa de ativação, aprovação ou pagamento. Vendas verificadas e ações pendentes continuam nos componentes já existentes.
- Teste de regressão `tests/daily-hub-network-v1-348.mjs` verifica prioridade de estado, limite por perfil, navegação segura, mensagens da Rede TAMÃO e CSS responsivo.
- Não foram realizados testes humanos autenticados ou medições de CTR/conversão nesta entrega. Não declarar aumento de vendas sem mensuração real.
- Após auditoria e deploy, comparar os três `portal-build.json` publicados com o commit da `main`.

## Próximas fases
- Pesquisa de usabilidade no balcão da revenda, pedidos em smartphone, configuração inicial e fluxos de falha.
- Revisão do catálogo, movimentação de pedidos, painel administrativo e atendimento móvel em perfis autenticados reais.
- Medição agregada de abandono entre entrada na revenda, primeiro catálogo, configuração de entrega e primeira oferta elegível. Evitar métricas artificiais.
