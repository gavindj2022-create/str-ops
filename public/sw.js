/* STR Ops service worker. Offline shell only; API and photo data are never cached. */
const CACHE='strops-shell-v2';
const ASSETS=['./','index.html','styles.css','data.js','api.js','app.js','manifest.webmanifest','icon.svg'];
self.addEventListener('install',e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',e=>{
  e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',e=>{
  const url=new URL(e.request.url);
  if(e.request.method!=='GET'||url.origin!==location.origin||url.pathname.startsWith('/api/')||url.pathname.includes('/photos/')) return;
  e.respondWith(
    fetch(e.request).then(response=>{
      if(response.ok&&(response.type==='basic'||response.type==='default')){
        const copy=response.clone();
        caches.open(CACHE).then(cache=>cache.put(e.request,copy));
      }
      return response;
    }).catch(()=>caches.match(e.request).then(cached=>cached||(e.request.mode==='navigate'?caches.match('index.html'):undefined)))
  );
});
