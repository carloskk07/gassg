const CACHE='chama-sg-v1.32';
const ASSETS=['./','./index.html','./css/base.css','./css/components.css','./js/runtime-config.js','./js/turnstile.js','./js/backend.js','./js/core.js','./js/customer.js','./js/growth.js','./js/merchant.js','./js/admin.js','./js/bootstrap.js','./manifest.webmanifest','./robots.txt','./icons/icon.svg'];

self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener('message',event=>{if(event.data==='SKIP_WAITING')self.skipWaiting()});

async function networkFirst(req,cacheKey=req){
  const cache=await caches.open(CACHE);
  try{
    const res=await fetch(req);
    if(res.ok){
      await cache.put(cacheKey,res.clone());
      return res;
    }
    return (await cache.match(cacheKey))||res;
  }catch{
    return (await cache.match(cacheKey))||Response.error();
  }
}

self.addEventListener('fetch',event=>{
  const req=event.request;
  if(req.method!=='GET')return;
  const url=new URL(req.url);
  if(url.origin!==self.location.origin){event.respondWith(fetch(req));return}
  event.respondWith(networkFirst(req,req.mode==='navigate'?'./index.html':req));
});
