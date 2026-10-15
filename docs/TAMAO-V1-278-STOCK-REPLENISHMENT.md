# TAMÃO V1.278 — Reposição rápida e revisão de preços

A área **Atualizar preço e estoque**, no início do painel da revenda, agora identifica produtos ativos **sem estoque**, produtos com estoque baixo (até 3 unidades, apenas um sinal de conferência) e preços **sem confirmação recente** segundo a regra de atualização já existente no TAMÃO. O resumo considera todos os produtos ativos com dados compatíveis, inclusive quando há mais de seis itens; o editor rápido continua limitado aos seis elegíveis e oferece o catálogo completo para os demais.

Para cada produto exibido, os atalhos **−1**, **+1** e **+5** ajustam somente o valor digitado na tela. O campo informa que a alteração **ainda não foi salva**. A revenda confere também o preço e clica em **Salvar alterações** para enviar ambos pelo serviço backend já existente, que usa autenticação, versionamento e releitura. Não há baixas, reposições ou mudanças de preços automáticas.

As ações são permitidas apenas a proprietários e gerentes autenticados; operadores, motoristas e pessoas sem acesso não podem editar. Os limites são 0 a 100.000 unidades inteiras, e o sistema não passa de estoque 0 para valores negativos. Produtos inativos ou com código inválido não entram no editor. Faixas automáticas de preço continuam sujeitas às restrições originais.

Mudanças restritas à interface do portal da revenda, CSS e testes. Não há novas APIs, migrations, movimentações financeiras ou alterações em pedidos.

**Testes:** `tests/merchant-stock-replenishment-v1-278.mjs` cobre contagens e alertas, sanitização de nomes, não gravação ao clicar nos atalhos, gravação explícita, permissões, limites e concorrência. Teste V1.277 atualizado para incluir as novas dependências; auditoria e testes móveis são obrigatórios.
