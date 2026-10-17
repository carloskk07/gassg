# TAMÃO V1.353 — Resposta consciente e fila objetiva da revenda

Data: 16/10/2026

## Problema observado
O cartão de uma oferta ainda permitia o botão "Aceitar pedido" quando o backend não retornava uma expiração legível. O servidor deveria rejeitar o aceite inválido, mas a interface induzia o operador a tentar algo que não podia ser considerado confiável. No resumo diário, o foco também tratava ofertas sem data válida como candidatas à próxima ação. A fila existia, porém a carga de trabalho por estado não era imediatamente perceptível.

## Correções
1. **Janela de resposta comprovada:** a interface só mostra ações de aceitar/rejeitar uma oferta quando `offerExpiresAt` é ISO legível e está no futuro com margem de um segundo. Prazo inválido/ausente ou vencido apresenta aviso e botão para atualizar; não é descrito como oferta disponível. O servidor continua com a validação autoritativa.
2. **Foco diário seguro:** `merchantDailyFocusModel` não promove ofertas sem expiração válida ou já vencidas como próximo aceite. Quando só há ofertas vencidas, a orientação pede recarregar do servidor.
3. **Resumo operacional à primeira vista:** total de ofertas válidas aguardando resposta, pedidos em incidente e entregas em andamento, calculados a partir da lista autorizada de pedidos da sessão. Alertas de prazos vencidos/indefinidos incluem atalho de consulta, mas não acionam transações.
4. **Navegação para ação real:** `merchantFocusOrderNextStep` só tenta focalizar o aceite quando a validade é comprovada. Nenhum atalho executa o aceite.
5. **Mobile e acessibilidade:** contadores legíveis, área de aviso responsiva, botões com alvo de toque e destaque de foco via teclado.

## Escopo e invariantes
- Sem RLS, migrações, Edge Functions, Supabase, operações financeiras, taxas, preços, estoque, cidade liberada, seleção automática de revenda ou alteração nos estados de pedidos.
- A ação real de aceitar, recusar, despachar, confirmar chegada e concluir entrega continua somente nos métodos existentes e sob verificação do servidor, versão e permissões.
- Os contadores mostram apenas os pedidos atribuídos àquela sessão da revenda (ou subconjunto do motorista), não o total de pedidos da cidade.
- Não afirmar resultado de vendas/conversão nem disponibilidade real sem provas.

## Verificações
- `tests/merchant-response-clarity-v1-353.mjs`: validade, ausência de prazo, expiração, prioridades, contadores por estado, isolamento da lista, ausência de mutação na renderização, acesso ao catálogo e CSS responsivo.
- Ajustes de regressão `tests/merchant-order-quick-queue-v1-174.mjs`, `tests/merchant-order-attention-v1-177.mjs`, `tests/merchant-order-mobile-v1-284.mjs` para exigir prazo real antes de esperar botões de aceite.
- Audit, Build isolated live portals, launch readiness, Cloudflare deploy e reconciliação pós merge são necessários antes de considerar a atualização em produção.

## Avaliação posterior
Ainda será necessário revisar visualmente no navegador autenticado e medir tempo para reconhecer/responder a ofertas, clareza do painel em celular e uso por proprietários, gerentes e operadores. Não substitui homologação de operações reais.
