// V1.1073 — Cloudflare Pages build output. Preserve dynamic canonical paths
// while NEVER rewriting static JS/CSS assets as HTML. Unknown SPA routes keep
// Cloudflare's native root fallback; a catch-all /* rewrite is unnecessary.
// Explicit static paths precede dynamic placeholders, per Cloudflare Pages.
export const TAMAO_CLOUDFLARE_NATIVE_ROUTES=[
  '/agenda/index.html /agenda/ 301',
  '/agenda/exemplo /agenda/exemplo/ 301',
  '/agenda/exemplo/ /agenda/exemplo/index.html 200',
  '/agenda/:slug /agenda/:slug/ 301',
  '/agenda/:slug/ /agenda/index.html 200',
  '/p/:slug/ /p/index.html 200',
  '/convite/:slug/ /convite/index.html 200'
].join('\n')+'\n';
