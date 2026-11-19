// V1.1074 — Cloudflare Pages Functions fallback for real participant and
// Agenda deep links. Git-linked Pages routing can serve the root SPA for an
// unknown path even when a static _redirects contract is present.
// Only one canonical HTML shell is served; no account data or money here.
const ALLOWED_SLUG=/^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CSP="default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://challenges.cloudflare.com; script-src-elem 'self' https://cdn.jsdelivr.net https://challenges.cloudflare.com; script-src-attr 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://lgugwujpunhslavewffd.supabase.co; font-src 'self' data:; connect-src 'self' https://lgugwujpunhslavewffd.supabase.co wss://lgugwujpunhslavewffd.supabase.co https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; frame-ancestors 'none'; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; media-src 'none'; upgrade-insecure-requests";

export async function nativePageRoute(context,kind){
  const {request,env,next}=context;
  const method=request.method;
  if(method!=='GET'&&method!=='HEAD')return next();
  if(kind!=='p'&&kind!=='agenda')return next();
  const url=new URL(request.url);
  // Request may have a trailing slash; never intercept static JS, CSS,
  // normal landing paths, or the published illustrative Agenda example.
  const segments=url.pathname.split('/').filter(Boolean);
  if(segments.length!==2||segments[0]!==kind)return next();
  const slug=segments[1];
  const max=kind==='agenda'?60:80;
  if(slug.length<4||slug.length>max||!ALLOWED_SLUG.test(slug))return next();
  if(!env?.ASSETS?.fetch){
    return new Response('Serviço temporariamente indisponível.',{
      status:503,headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}
    });
  }
  // Static directory root, not /index.html: Pages canonicalizes index.html
  // to / and would otherwise return a 301 instead of the HTML shell.
  const isPremiumExample=kind==='agenda'&&slug==='exemplo';
  const assetUrl=new URL(isPremiumExample?'/agenda/exemplo/':'/'+kind+'/',url);
  const staticPage=await env.ASSETS.fetch(assetUrl.toString());
  if(!staticPage.ok||!String(staticPage.headers.get('Content-Type')||'').toLowerCase().includes('text/html')){
    return new Response('Página temporariamente indisponível.',{
      status:503,headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}
    });
  }
  const headers=new Headers(staticPage.headers);
  headers.set('Content-Type','text/html; charset=utf-8');
  headers.set('Cache-Control','no-store');
  headers.set('Content-Security-Policy',isPremiumExample
    ?CSP.replace("img-src 'self' data: blob: https://lgugwujpunhslavewffd.supabase.co;",
      "img-src 'self' data: blob: https://lgugwujpunhslavewffd.supabase.co https://images.unsplash.com;")
    :CSP);
  headers.set('X-Content-Type-Options','nosniff');
  headers.set('X-Frame-Options','DENY');
  headers.set('Referrer-Policy','strict-origin-when-cross-origin');
  headers.set('Permissions-Policy','camera=(), microphone=(), geolocation=()');
  headers.set('Cross-Origin-Resource-Policy','same-origin');
  headers.set('X-Robots-Tag','noindex, follow, noarchive, nosnippet');
  return new Response(method==='HEAD'?null:staticPage.body,{status:200,headers});
}
