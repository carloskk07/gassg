# TAMÃO V1.982 — Modernização de jornadas nos três portais

Continuação incremental do projeto existente a partir da V1.981.

## Cliente
- No painel regional sem preços verificados, a chamada orienta a escolha no catálogo; atualizar cotações só é oferecido quando há preços confirmados.
- Checkout com orientação em quatro passos e separação mais compacta de tarefa e formulário; nenhum preço ou pedido inventado.
- Clube, Rede e páginas comerciais recebem hierarquia visual por CSS diferido, com indicadores de foco mantidos para navegação por teclado.

## Parceiro
- Os 16 componentes de crescimento e publicidade continuam existentes, agrupados em três categorias operacionais recolhíveis.
- A fila de pedidos e os controles de produtos/estoque permanecem prioritários. Nenhuma autorização ou validação é removida.

## Admin
- Busca primeiro, seletor de tarefas logo abaixo.
- Visão geral mantém alertas, controles de lançamento e governança expostos; publicação e indicadores complementares são acessíveis sob demanda.

## Páginas suspensas
- Hospedagens em SPA possui ação de retorno coerente, sem links desformatados.
- Landing pages em português/espanhol preservam indisponibilidade e noindex com visual de modalidade suspensa.

## Garantias e validação
- Mudanças concentradas em texto, composição, HTML e CSS, sem alterar procedimentos financeiros, RLS, pagamentos, estoque, serviços ou política comercial.
- Os recursos por rota são carregados sob demanda, com foco em preservar o orçamento de carregamento inicial.
- Teste de contrato: `tests/modernizacao-transversal-v1-982.mjs`, integrado ao Audit.
- Sucesso de CI não equivale a homologação comercial. A experiência autenticada em aparelhos reais e transações ponta a ponta permanecem verificações separadas.
