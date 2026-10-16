# TAMÃO V1.339.1 — Recuperação de publicação Cloudflare Pages

Data da apuração: 16/10/2026. Repositório `carloskk07/gassg`.

## Incidente confirmado (não é defeito financeiro)

A versão V1.339 foi integrada em `main` no commit `95a3e82618391be8bd5f6cf2fcd4442df97da82e`, com Audit e build de três portais aprovados no GitHub.

No entanto, após esse merge, a verificação remota registrou:
- `https://tamao.com.br/portal-build.json`: **customer** em `95a3e826...`;
- `https://parceiro.tamao.com.br/portal-build.json`: **merchant** em `95a3e826...`;
- `https://admin.tamao.com.br/portal-build.json`: **admin** em `d15c756d...` (anterior).

Na Cloudflare Pages, o projeto `tamao-sg-admin`, deployment da revisão `95a3e826`, terminou com **failure** e esta mensagem no build log:

> Failed: build failed to initialize in time. If this continues, contact support.

O erro antecedeu as etapas normais `clone repo`, `build` e `deploy`: a evidência disponível não permite atribuí-lo ao código da V1.339. **Não** desabilitar a checagem remota ou substituir artificialmente o SHA registrado em Supabase.

## Recuperação segura

1. Como os três projetos Cloudflare Pages são vinculados ao GitHub e indicam deploy automático habilitado, um commit novo e não funcional em `main` pode solicitar nova construção nativa. Este relatório serve como alteração rastreável para uma tentativa, sem mudar código ou políticas financeiras.
2. Revisar no painel da Cloudflare o último deployment do projeto `tamao-sg-admin`; se o build falhar de novo na inicialização, usar a opção **Retry deployment** no deployment fracassado ou consultar suporte Cloudflare. Uma tentativa de retry não garante sucesso.
3. O fluxo alternativo do GitHub Actions, `cloudflare-production-deploy.yml`, falha corretamente quando a publicação nativa diverge e **não existem** os secrets `CLOUDFLARE_API_TOKEN` e `CLOUDFLARE_ACCOUNT_ID`. Não presumir que estejam configurados e não gravar o token no repositório, documentação ou chat.
4. Para tornar o fallback permanente, cadastrar os dois secrets sob GitHub → Settings → Secrets and variables → Actions, a partir de token Cloudflare com o menor escopo de edição de Pages para esses projetos. Depois executar novamente o workflow oficial de deploy. Conferir permissões reais na Cloudflare antes de atribuí-las.
5. Concluir apenas com `node tests/remote-admin-readiness.mjs` em modo estrito (SHA oficial), workflow de prontidão e `Cloudflare native delivery reconcile` aprovados, e `platform_launch_control.portals_source_sha` coincidente com `main`.

**Proibições operacionais:** não liberar comércio/cidades, não criar pedidos, não gerar saldos, não marcar pagamentos como comprovados. Uma build isolada não justifica declarar a publicação confirmada.

## Resultado esperado deste commit

- Uma única tentativa nova de deploy Git → Cloudflare Pages, mantendo intactas regras financeiras, Edge Functions, permissões e configurações de produtos.
- Se ainda falhar a infraestrutura nativa, registrar resultado e depender de Retry deployment ou secret de recuperação. Evitar novas alterações cosméticas apenas para reacionar builds indefinidamente.
