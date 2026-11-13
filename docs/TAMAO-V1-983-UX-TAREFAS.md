# TAMÃO V1.983 — jornadas mais objetivas em todos os portais

Continua a partir da V1.982, sem reiniciar o repositório e sem mudar o banco, pagamentos ou as regras comerciais.

- **Cliente:** estado sem pedido real ou simulado deixa de induzir compra de apenas gás P13 e oferece escolha de qualquer produto; preserva recuperação de referência de pedido ainda sem leitura confirmada.
- **Portal público:** rodapé dividido em apresentação, serviços e atendimento/direitos, preservando todos os destinos e links editoriais indexáveis.
- **Parceiro:** Divulgação/Crescimento permite escolher diretamente uma das três tarefas; apenas um grupo fica aberto por vez; foco e rolagem são controlados, sem enviar campanhas nem executar mutações.
- **Admin:** próxima decisão e alertas verificados aparecem antes de indicadores e caminhos duplicados; atalhos adicionais ficam sob divulgação opcional.
- **Visual transversal:** hierarquia, estados vazios, foco de teclado, texto responsivo e páginas editoriais com regras de acessibilidade, incluindo largura reduzida e preferência por menos movimento.

Verificação: `tests/modernizacao-ux-v1-983.mjs` no Audit, regressões existentes, build dos três portais, orçamento de carregamento, integração isolada e revisão visual. Aprovação de CI não substitui testes autenticados e operação comercial real.

Publicação por Cloudflare Pages conectado ao GitHub: sem novos tokens. A conferência da versão deve comparar `portal-build.json` dos três domínios com o SHA canônico da main; a ausência de sincronização de um portal não equivale a falta de credenciais.
