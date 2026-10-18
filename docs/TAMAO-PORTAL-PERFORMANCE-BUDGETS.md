# TAMÃO — Orçamento de desempenho dos três portais

Base: commit oficial `63ae5d88f150d24bdab55e74cdda4a70eb1c100e`.

O verificador analisa o pacote real de cliente, revenda e administrador. Ele soma arquivos JS/CSS necessários na primeira abertura, seus tamanhos brutos, as estimativas gzip/Brotli, a quantidade de requisições iniciais e os recursos administrativos carregados sob demanda. O relatório determinístico é gravado em `dist/portal-performance-report.json`.

Os limites ficam em `performance/portal-budgets.json` e bloqueiam aumentos acima de uma margem de aproximadamente 7–9% em relação à revisão de referência. A verificação também reprova um pacote sem arquivos, com cache versionado incompatível ou com módulos administrativos exclusivos voltando para o carregamento inicial.

Esta é uma medição de **peso do pacote**, não de latência, velocidade percebida ou Core Web Vitals. Gzip e Brotli são estimativas locais por arquivo; o tamanho HTTP efetivamente transferido depende do servidor, cabeçalhos e cache. Para medir LCP, INP e tempo até interação em celulares reais, usar coleta separada e distribuições estatísticas, sem converter uma execução instável de CI em limite absoluto.

Execução local: `node scripts/build-live-portals.mjs`, depois `node scripts/portal-performance-budget.mjs dist/live-portals`. Para elevar um limite, justificar a funcionalidade e comparar os números dos três portais no review.
