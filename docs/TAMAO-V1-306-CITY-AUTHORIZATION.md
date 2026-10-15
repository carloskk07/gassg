# TAMÃO V1.306 — Abertura de cidades sob decisão administrativa

## Falha identificada
A tabela `market_cities` possuía `commerce_enabled`, mas a seleção server-side de revendas ofertáveis (`market_city_offer_scope`) apenas respeitava `admin_paused` e a abertura global. Portanto, mesmo com `commerce_enabled=false`, uma cidade poderia ser considerada ofertável quando o modo global fosse liberado. Essa assimetria era incompatível com a determinação de que o admin tenha controle real sobre cada cidade.

## Correção
- `market_city_offer_scope` agora exige **ambos**: `commerce_enabled=true` e `admin_paused=false` na cidade cadastrada. As exigências já existentes de modo global PILOT/LIVE, revenda ativa, conformidade, estoque, preço recente, entrega, pagamento e heartbeat permanecem obrigatórias.
- Nova RPC `admin_set_market_city_commerce` é `SECURITY DEFINER`, **service_role-only**, com verificação adicional de `platform_admins.admin_role='superadmin'`, argumentos validados, bloqueio de abertura de cidade pausada e exigência de pelo menos uma revenda efetivamente ativa, com CNPJ conforme, catálogo elegível, owner ativo e forma de pagamento ativa. Se a cidade ainda não está cadastrada, recusa; não cria cidades silenciosamente.
- Alterações gravam auditoria em `platform_admin_audit`, incluindo valor anterior, novo, justificativa e responsável. Repetir o mesmo estado não duplica auditoria.
- Endpoint `admin-ops` verifica JWT real e papel de superadmin, usa o ID do JWT, requer chave de idempotência para a chamada e delega à RPC o controle final. Nenhum segredo entregue ao navegador.
- Painel administrativo exibe ações separadas **Autorizar/Suspender comércio** (superadmin) e **Pausar/Retirar pausa** (superadmin ou operações). Operações e leitura não recebem botão de abertura. Confirmação e justificativa são obrigatórias.

## Efeitos práticos
- Desabilitar o comércio da cidade impede **novas ofertas/cotações elegíveis** e também a conversão de cotações antigas em novos pedidos pelo checkout oficial V8. A decisão não cancela pedidos já criados; repetição idempotente de um pedido confirmado continua consultável.
- Autorizar a cidade, por si só, não altera modo global, habilitação financeira, preços ou status de revendas; pedidos só podem ocorrer se todos os demais requisitos continuarem verdadeiros.
- Não modifica São Gabriel/RS automaticamente. Quando houver revenda apta, cabe ao administrador principal decidir a abertura.
- Indicações e cadastramento de interessados de outras cidades permanecem possíveis sem liberar venda antecipadamente.

## Próximos controles a auditar
Confirmar que qualquer outro construtor de ofertas usa `market_city_offer_scope`, incluindo simulações, agendamento e recompras; rever flags de campanhas, PSP e benefícios para respeitarem permissões administrativas server-side. Realizar validação ponta a ponta **com pedido autorizado**, sem simular transações financeiras reais.

## Verificação
Teste de ausência de privilégios públicos na nova RPC; inspeção da função de cotação; ensaios de rejeição de papel não autorizado, cidade não descoberta, cidade pausada e cidade sem revenda apta; CI de regressão e smoke mobile; verificação da versão idêntica do Edge em produção.
