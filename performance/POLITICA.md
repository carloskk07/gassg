# Política de desempenho TAMÃO

## Objetivo
Preservar uma experiência rápida, completa e acessível, sem transformar o tamanho bruto em uma medida única de qualidade.

## Controles de publicação
- Cada portal tem orçamento próprio para JavaScript e CSS iniciais descomprimidos, número de requisições, JavaScript gzip/Brotli e transferência inicial combinada de JS+CSS.
- O tamanho descomprimido continua sendo um indicador indireto de custo de parsing e memória. A compressão não reduz esse custo.
- Gzip e Brotli são estimativas reproduzíveis do build, somadas por arquivo; não são medidas de tráfego real, tempo de carregamento, imagens ou todo o conteúdo da página.
- Avisos a partir de 85% do teto permitem revisar a arquitetura antes de bloquear uma entrega. Ultrapassar um teto ainda impede a aprovação.
- Os limites são versionados e revisados por decisão explícita; não aumentam automaticamente.
- Nenhuma mudança nos controles de segurança, acesso, integridade de cache ou validações comerciais. As verificações de isolamento e de módulos deferidos permanecem obrigatórias.

## Referência inicial
Build aprovado de 06c959e8ebc488d756fb99458afd2863218dec5f: JS inicial bruto de 529887/919813/1320535 bytes nos portais Cliente/Parceiro/Admin; JS gzip de 143638/239895/333591 bytes; JS Brotli de 123160/200942/265569 bytes. A nova margem evita mudanças repetidas de microtexto por poucas centenas de bytes, mantendo limites absolutos e comprimidos.

## Próximas evoluções
1. Priorizar módulos acionados sob demanda, com carregamento versionado, recuperação de falhas e estados de espera acessíveis.
2. Medir navegação real em navegador móvel, CPU/rede limitadas, imagens, fontes e métricas de experiência (LCP, INP e CLS); não confundir teste sintético com dados de usuários reais.
3. Manter os fluxos essenciais disponíveis sem aguardar recursos opcionais, e validar retorno, erros, troca de sessão e cache.
4. Avaliar mudanças de orçamento à luz das medições e da complexidade de cada portal, preservando a qualidade visual.

O relatório `portal-performance-report.json` inclui utilização, margem e avisos por métrica. O esquema de relatório mantém compatibilidade aditiva com os campos existentes.
