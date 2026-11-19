// V1.1073 — Cloudflare Pages build output. Preserve dynamic canonical paths
// with a proven temporary redirect to the existing static app page. Unknown SPA routes keep
// Cloudflare's native root fallback; a catch-all /* rewrite is unnecessary.
// The app restores the clean vanity URL with history.replaceState before rendering.
// Explicit static paths precede dynamic placeholders, per Cloudflare Pages.
export const TAMAO_CLOUDFLARE_NATIVE_ROUTES=[
  '/agenda/index.html /agenda/ 301',
  '/agenda/exemplo /agenda/exemplo/ 301',
  '/p/:slug/ /p/?slug=:slug 302',
  '/convite/:slug/ /convite/?a=customer 302'
].join('\n')+'\n';
