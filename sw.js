const CACHE='tamao-sg-v1.413';
const AUTH_SDK_URL='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.js';
const ASSETS=['./','./index.html','./css/base.css','./css/components.css','./css/marketing-premium.css','./js/runtime-config.js','./js/turnstile.js','./js/backend.js','./js/core.js','./js/analytics.js','./js/acquisition.js','./js/legal.js','./js/home-showcase.js','./js/customer.js','./js/growth.js','./js/merchant.js','./js/merchant-offline-delivery.js','./js/admin-acquisition.js','./js/admin.js','./js/admin-activations.js','./js/bootstrap.js','./manifest.webmanifest','./robots.txt','./icons/icon.svg','./assets/tamao-products-sprite.webp'];

self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(async cache=>{
    await cache.addAll(ASSETS);
    // Offline startup needs this public, SRI-pinned SDK, never auth tokens.
    // A CDN outage must not block installing the application's own shell.
    const abort=new AbortController();
    const timeout=setTimeout(()=>abort.abort(),3500);
    try{
      const request=new Request(AUTH_SDK_URL,{mode:'cors'});
      const response=await fetch(request,{signal:abort.signal});
      if(response.ok&&response.type==='cors')await cache.put(request,response);
    }catch{}finally{clearTimeout(timeout)}
  }).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener('message',event=>{if(event.data==='SKIP_WAITING')self.skipWaiting()});

async function networkFirst(req,cacheKey=req){
  const cache=await caches.open(CACHE);
  try{
    const res=await fetch(req,{cache:'no-store'});
    if(res.ok){
      await cache.put(cacheKey,res.clone());
      return res;
    }
    return (await cache.match(cacheKey))||res;
  }catch{
    return (await cache.match(cacheKey))||Response.error();
  }
}

async function versionedAssetCacheFirst(req){
  const cache=await caches.open(CACHE);
  const saved=await cache.match(req);
  return saved||networkFirst(req);
}

async function navigationNetworkFirst(req){
  const cache=await caches.open(CACHE);
  try{
    const res=await fetch(req,{cache:'no-store'});
    if(res.ok){
      const contentType=String(res.headers.get('content-type')||'').toLowerCase();
      // Independent editorial HTML must never overwrite the application's
      // offline shell; keep it under its own URL when visited.
      const editorialPath=/^\/(?:como-funciona|para-revendas|para-marcas|indicacoes)(?:\/|\/index\.html)?$/i
        .test(new URL(req.url).pathname);
      if(contentType.includes('text/html')&&!editorialPath){
        await cache.put('./index.html',res.clone());
      }else{
        await cache.put(req,res.clone());
      }
    }
    return res;
  }catch{
    return (await cache.match(req))||(await cache.match('./index.html'))||Response.error();
  }
}

self.addEventListener('fetch',event=>{
  const req=event.request;
  if(req.method!=='GET')return;
  const url=new URL(req.url);
  if(url.origin!==self.location.origin){
    event.respondWith(url.href===AUTH_SDK_URL?networkFirst(req):fetch(req));return
  }
  if(req.mode==='navigate'){
    event.respondWith(navigationNetworkFirst(req));
    return;
  }
  // Release build pins all static assets to its source SHA. Serve a matching
  // installed snapshot immediately on repeated visits; network-first remains
  // mandatory for HTML, unversioned URLs and dynamic runtime configuration.
  if(url.searchParams.has('v')&&/^\/(?:js|css)\/[A-Za-z0-9._/-]+$/.test(url.pathname)
    &&url.pathname!=='/js/runtime-config.js'){
    event.respondWith(versionedAssetCacheFirst(req));
    return;
  }
  event.respondWith(networkFirst(req));
});

// V1.286: accepts only generic merchant events. No address, phone, PIN,
// customer name, order ID or financial amount is shown on a lock screen.
self.addEventListener('push',event=>{
  let payload=null;
  try{payload=event.data?.json()??null}catch{}
  const kind=payload?.kind;
  if(!['new_offer','assigned_delivery','test'].includes(kind))return;
  const isDriver=kind==='assigned_delivery';
  const isTest=kind==='test';
  event.waitUntil(self.registration.showNotification(
    isTest?'Teste de notificação TAMÃO':isDriver?'Nova entrega no TAMÃO':'Novo pedido no TAMÃO',{
      body:isTest?'Você solicitou este aviso no Portal das Revendas TAMÃO.':isDriver?'Confira a entrega atribuída no painel.':'Um pedido precisa da sua atenção no painel.',
      icon:'./icons/icon.svg',
      badge:'./icons/icon.svg',
      tag:'tamao-merchant-push-'+kind,
      // A user-triggered test should not repeatedly buzz like a campaign.\n      renotify:!isTest,
      data:{url:'./?merchant=1#merchant'}
    }
  ));
});

self.addEventListener('notificationclick',event=>{
  event.notification?.close();
  // Only these two fixed routes are permitted; never follow a URL supplied
  // by an arbitrary push payload. Existing merchant alerts retain their route.
  const mobility=event.notification?.data?.url==='./?mobility=1#mobility';
  const target=new URL(mobility?'./?mobility=1#mobility':'./?merchant=1#merchant',
    self.registration.scope).href;
  event.waitUntil(
    self.clients.matchAll({type:'window',includeUncontrolled:true}).then(async windows=>{
      for(const client of windows){
        // A reopened mobile mobility page may remove its query parameter.
        const page=new URL(client.url);
        const base=new URL('./',self.registration.scope);
        const matchingRoute=mobility?
          (page.searchParams.get('mobility')==='1'||page.hash==='#mobility'):
          page.searchParams.get('merchant')==='1';
        if(page.origin===base.origin&&page.pathname.startsWith(base.pathname)&&matchingRoute){
          try{await client.focus()}catch{}
          try{await client.navigate(target)}catch{}
          return;
        }
      }
      if(self.clients.openWindow)await self.clients.openWindow(target);
    })
  );
});
