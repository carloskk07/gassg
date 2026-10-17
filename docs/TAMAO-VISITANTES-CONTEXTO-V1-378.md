# TAMÃO V1.378 — Contexto preservado e páginas comerciais com identidade própria

Data: 17/10/2026.

## Problema observado

A V1.377 entregou páginas editoriais independentes e otimizadas para buscas, mas a navegação desses endereços de volta ao aplicativo descartava os parâmetros de origem (UTM) e indicação (`ref`). Um anúncio ou convite poderia chegar corretamente a `/para-revendas/`, mas perder sua atribuição ao clicar em "Quero apresentar minha empresa".

A mesma ilustração de gás e água aparecia em páginas de públicos diferentes — inclusive marcas e Rede TAMÃO — apesar de os visitantes terem objetivos distintos.

## V1.378

1. **Transferência responsável da campanha.** O novo `js/landing-handoff.js` adiciona apenas `ref`, `utm_source`, `utm_medium`, `utm_campaign`, `utm_content` e `utm_term` em links públicos do próprio domínio. Rejeita campos duplicados, parâmetros malformados, valores extensos e caminhos ou fragmentos fora da lista pública. Não substitui parâmetros explícitos no destino.
2. **Navegação progressiva.** Sem JavaScript, todos os links continuam funcionais; com JavaScript, preservam o contexto de aquisição. Não há rastreamento extra, cookies, API, redirecionamentos automáticos ou gravação de dados pessoais por essa melhoria.
3. **Quatro visuais distintos.** A página do cliente continua com as imagens locais de produtos; a de revendas usa uma composição ilustrativa de catálogo, entregas e disponibilidade; a de marcas representa formatos de divulgação e benefícios; a da Rede TAMÃO mostra conexões com consumidores e empresas. Os três novos conceitos trazem legenda de ilustração e não representam operações efetivas.
4. **Conversão preservada.** Os botões ainda entregam o visitante às jornadas do TAMÃO e nunca efetuam pedidos, movimentações financeiras ou liberação de cidades.

## Segurança e testes

- As CTAs carregam apenas parâmetros de campanhas expressamente permitidos em URLs do domínio público.
- Origem HTTPS e destino same-origin obrigatórios; páginas privadas, rotas de checkout e fragmentos desconhecidos não recebem contexto automaticamente.
- `tests/public-handoff-visual-v1-378.mjs`: ref e UTM, integridade de `entrada=...`, rejeição de links externos/privados, ausência de rastreamento, roteiros com e sem contexto, arte específica por audiência e estilos móveis.
- Atualizada a suíte da V1.377 para reconhecer o único script próprio e diferido, sem aceitar scripts terceiros ou inline.
- A suíte de auditoria e os builds isolados dos portais são necessários antes de integrar.

## Limites

Isso corrige a perda de parâmetros do visitante, mas não comprova atribuição financeira, remuneração de indicação ou aumento de conversão. Qualquer benefício depende das validações comerciais e financeiras já existentes. A aparência final em dispositivos físicos e a entrega Cloudflare precisam ser verificadas separadamente.
