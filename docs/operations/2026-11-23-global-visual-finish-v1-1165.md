# TAMÃO V1.1165 — auditoria de acabamento visual transversal

Data: 23/11/2026. Escopo de apresentação, sem ativar comércio, alterar saldos ou realizar operações financeiras.

## Revisão de interfaces
- **Home**: atalhos de compradores, empresas, indicações, serviços, catálogo, Clube e benefícios; emojis dependentes do sistema operacional identificados em seis cartões, quatro atalhos e seis acessos a serviços.
- **Clube `#club`**: preservada a V1.1164 com vantagens reais e conta identificada; barra pública de cupons agora usa ícones uniformes em vez de adesivos de emoji.
- **Rede / `#earn`**: preservados os simuladores e percentuais homologados; o ilustrativo de conexões do painel secundário passa a usar símbolos consistentes.
- **Guia `#learn`**: ícones de Clube e Rede ganham aparência finalizada, sem estrelas soltas.
- **Publicidade `#sponsors`**: espaços de demonstração deixam de imitar telas parcialmente carregadas; mostram categorias verdadeiras e rótulos explicitamente conceituais. Preço, revisão, inventário e anúncios ativos seguem condicionados ao backend.
- **Revendas `#merchants`**, **Profissionais `#professionals`**, **Mobilidade `#mobility`** e **Caronas `#rides`**: inspeção dos cabeçalhos oficiais e manutenção dos componentes premium existentes; ícones compartilhados e foco passam pelo tratamento transversal quando aplicável.
- **Agenda pública e personalização**: sem imagem cadastrada, os serviços usam símbolo de calendário e o perfil/equipe usa a primeira letra do nome público; não se insere fotografia, pessoa, estabelecimento ou reserva fictícia.
- **Cadastro, pedidos e carteira**: sem mudança nas ações, permissões, valores ou políticas, e sem introduzir páginas de simulação públicas.

## Padrão implementado
O arquivo `css/visual-finish.css` define 19 símbolos vetoriais SVG de sistema em uma linguagem de marca. Os elementos decorativos antes representados por emoji preservam seus destinos, papéis e descrições textuais. Todos os ícones são `::before` sem ações próprias. O caminho de carregamento é cacheado no service worker. A Agenda dispõe de uma camada específica de fallback de mídia, honesta e responsiva.

## Controle de qualidade obrigatório
- `tests/global-visual-finish-v1-1165.mjs`: HTML/CSS/JS, placeholders reais, catálogo, acesso e integridade do contrato Clube/Rede.
- `tests/global-visual-browser-v1-1165.mjs`: render Chrome 360/1280 px nas rotas Home, Learn, Sponsors, Earn e Club; verifica ícones SVG, ausência de esqueleto vazio e cortes horizontais.
- Audit geral, build dos portais com orçamento de carregamento, smoke visual e integração Supabase isolada não podem ser ignorados.
- Validar publicação Cloudflare na mesma revisão para Cliente/Parceiro/Admin.

## Limites explícitos
Isto é uma evolução transversal de acabamento, não uma alegação de auditoria integral de cada tela autenticada e de cada configuração individual da Agenda. Fotografias que dependam de licença, consentimento, ou acervo real do participante não são substituídas por arquivos inventados. Os estados vazios e de carregamento necessários continuam funcionais e identificados como tais. Qualquer falha financeira, autorização, RLS ou ativação comercial continua sujeita à própria homologação.
