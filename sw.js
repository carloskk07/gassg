const CACHE='chama-sg-v1.25';
const ASSETS=['./','./index.html','./css/base.css','./css/components.css','./js/runtime-config.js','./js/turnstile.js','./js/backend.js','./js/core.js','./js/customer.js','./js/growth.js','./js/merchant.js','./js/admin.js','./js/bootstrap.js','./manifest.webmanifest','./icons/icon.svg'];

self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener('message',event=>{if(event.data==='SKIP_WAITING')self.skipWaiting()});

self.addEventListener('fetch',event=>{
  const req=event.request;
  if(req.method!=='GET')return;
  const url=new URL(req.url);
  if(url.origin!==self.location.origin){event.respondWith(fetch(req));return}

  if(req.mode==='navigate'){
    event.respondWith(
      fetch(req).then(res=>{
        if(res.ok)caches.open(CACHE).then(c=>c.put('./index.html',res.clone()));
        return res;
      }).catch(()=>caches.match('./index.html'))
    );
    return;
  }

  event.respondWith(
    fetch(req).then(res=>{
      if(res.ok)caches.open(CACHE).then(c=>c.put(req,res.clone()));
      return res;
    }).catch(()=>caches.match(req))
  );
});
