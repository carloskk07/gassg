// V1.1074 — Cloudflare Pages Functions fallback for real participant and
// Agenda deep links. Git-linked Pages routing can serve the root SPA for an
// unknown path even when a static _redirects contract is present.
// Only one canonical HTML shell is served; no account data or money here.
const ALLOWED_SLUG=/^[a-z0-9]+(?:-[a-z0-9]+)*$/;
// Social crawlers don't execute our client JS. Only the already-approved,
// PUBLIC participant endpoint may supply social metadata for published pages.
const PUBLIC_PAGE_API='https://lgugwujpunhslavewffd.supabase.co/functions/v1/participant-pages';
const PUBLIC_KINDS=new Set(['merchant','customer','listing','agenda','driver','advertiser']);
const PUBLIC_MEDIA=/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(?:jpg|jpeg|png|webp)$/;
function safeAttr(value){
 return String(value??'').replace(/[\u0000-\u001f]/g,' ').replace(/&/g,'&amp;')
   .replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function verifiedSocial(data,slug){
 if(!data||data.source!=='participant_native_page_v1_1072'||data.slug!==slug||
    !PUBLIC_KINDS.has(data.kind)||typeof data.name!=='string'||!data.name.trim())return null;
 const name=data.name.trim().slice(0,120);
 const description=String(data.tagline||data.details||'Conheça este participante no TAMÃO.')
   .replace(/[\u0000-\u001f]/g,' ').trim().slice(0,185);
 const photo=(Array.isArray(data.photos)?data.photos:[]).find(x=>typeof x==='string'&&PUBLIC_MEDIA.test(x));
 const image=photo?'https://lgugwujpunhslavewffd.supabase.co/storage/v1/object/public/tamao-discovery-photos/'+
  photo.split('/').map(encodeURIComponent).join('/'):'';
 return {title:name+' • TAMÃO',name,description,url:'https://tamao.com.br/p/'+slug+'/',image};
}
function socialHtml(html,card){
 const title=safeAttr(card.title),description=safeAttr(card.description),url=safeAttr(card.url);
 const image=card.image?'<meta property="og:image" content="'+safeAttr(card.image)+'">'+
  '<meta property="og:image:alt" content="'+safeAttr('Foto pública de '+card.name)+'">':'';
 return html
  .replace(/<title>[\s\S]*?<\/title>/i,'<title>'+title+'</title>')
  .replace(/<meta\s+name="robots"[^>]*>/i,'<meta name="robots" content="index,follow">')
  .replace(/<meta\s+name="description"[^>]*>/i,'<meta name="description" content="'+description+'">')
  .replace(/<meta\s+property="og:title"[^>]*>/i,'<meta property="og:title" content="'+title+'">')
  .replace(/<meta\s+property="og:description"[^>]*>/i,'<meta property="og:description" content="'+description+'">')
  .replace('</head>','<meta property="og:url" content="'+url+'">'+
   '<meta property="og:locale" content="pt_BR">'+image+
   '<meta name="twitter:card" content="'+(card.image?'summary_large_image':'summary')+'">'+
   '<meta name="twitter:title" content="'+title+'">'+
   '<meta name="twitter:description" content="'+description+'">'+
   '<link rel="canonical" href="'+url+'"></head>');
}
async function socialCardFor(slug){
 if(typeof fetch!=='function')return null;
 const ctl=new AbortController(),timeout=setTimeout(()=>ctl.abort(),2200);
 try{
  const res=await fetch(PUBLIC_PAGE_API,{method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({action:'view',slug}),signal:ctl.signal,cache:'no-store'});
  if(!res.ok)return null;
  return verifiedSocial(await res.json(),slug);
 }catch{return null}finally{clearTimeout(timeout)}
}

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
  if(slug.length<4||slug.length>max||!ALLOWED_SLUG.test(slug)||
    (kind==='agenda'&&slug==='exemplo'))return next();
  if(!env?.ASSETS?.fetch){
    return new Response('Serviço temporariamente indisponível.',{
      status:503,headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}
    });
  }
  // Static directory root, not /index.html: Pages canonicalizes index.html
  // to / and would otherwise return a 301 instead of the HTML shell.
  const assetUrl=new URL('/'+kind+'/',url);
  const staticPage=await env.ASSETS.fetch(assetUrl.toString());
  if(!staticPage.ok||!String(staticPage.headers.get('Content-Type')||'').toLowerCase().includes('text/html')){
    return new Response('Página temporariamente indisponível.',{
      status:503,headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}
    });
  }
  const social=kind==='p'&&method==='GET'?await socialCardFor(slug):null;
  const headers=new Headers(staticPage.headers);
  headers.set('Content-Type','text/html; charset=utf-8');
  headers.set('Cache-Control','no-store');
  headers.set('Content-Security-Policy',CSP);
  headers.set('X-Content-Type-Options','nosniff');
  headers.set('X-Frame-Options','DENY');
  headers.set('Referrer-Policy','strict-origin-when-cross-origin');
  headers.set('Permissions-Policy','camera=(), microphone=(), geolocation=()');
  headers.set('Cross-Origin-Resource-Policy','same-origin');
  headers.set('X-Robots-Tag','noindex, follow, noarchive, nosnippet');
  if(!social)return new Response(method==='HEAD'?null:staticPage.body,{status:200,headers});
  const html=await staticPage.text();
  if(!/<\/head>/i.test(html)||!/<meta\s+name="robots"/i.test(html))
   return new Response(html,{status:200,headers});
  headers.set('X-Robots-Tag','index, follow');
  headers.delete('Content-Length');headers.delete('Content-Encoding');headers.delete('ETag');
  return new Response(socialHtml(html,social),{status:200,headers});
}
