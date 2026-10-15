# TAMÃO V1.277 — Ajuste rápido de preço e estoque

## Acesso
No começo do painel da revenda, abra **Atualizar preço e estoque** ou toque em **Ajustar estoque e preços** em **Sua operação agora**.

O novo formulário compacto mostra até **seis produtos ativos com preço e estoque válidos**, destacando o P13 quando existir e produtos com estoque zerado. Inclui água e outros produtos oferecidos pela revenda. Cada linha permite atualizar preço e unidades disponíveis e salvar **apenas aquele produto**; valores são confirmados pelo mesmo serviço `merchantUpdateProductLive` usado pelo catálogo, com tratamento de conflito de versão e nova leitura do servidor.

A área oferece um atalho para **Abrir catálogo completo** para os demais produtos, faixas e opções. Produtos inativos não são reativados pelo formulário rápido. Para preços de faixa automática, a edição somente aceita preço normal dentro dos limites atuais e envia os limites/estratégia existentes sem mudá-los; configurações inválidas precisam ser corrigidas no catálogo completo.

## Segurança e simplicidade
- Visível apenas ao proprietário ou gerente; operador e motorista não podem editar.
- Não aceita valores em branco, estoque negativo/fracionado/acima de 100.000, nem preço inválido.
- Bloqueia ações enquanto a operação já possui alteração pendente.
- Não duplica identificadores dos formulários antigos: o editor tardio de P13 foi substituído por links para o novo ajuste e catálogo completo.
- Preserva autorização, concorrência e idempotência do backend. Estoque 0 não cria novas ofertas; não cancela pedidos em andamento.
- Não altera banco, Edge Functions, PSP, pagamentos ou transições de pedido.

## Evidências
Teste de regressão `tests/merchant-quick-catalog-v1-277.mjs` cobre preços fixos e por faixa, estoque zero, múltiplos produtos, duplicatas, dados maliciosos, permissões, salvamento e erros. A auditoria e testes de navegação móvel continuam obrigatórios.
