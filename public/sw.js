/* STR Ops service worker — offline shell cache (works-offline foundation) */
const CACHE='strops-v1';
const ASSETS=['index.html','styles.css','data.js','app.js','manifest.webmanifest','icon.svg'];
self.addEventListener('install', e=>{ e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())); });
self.addEventListener('activate', e=>{ e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())); });
self.addEventListener('fetch', e=>{
  const u=new URL(e.request.url);
  if(u.origin!==location.origin){ return; } // let fonts hit network
  // Network-first so the team always gets the latest code; fall back to cache offline.
  e.respondWith(fetch(e.request).then(res=>{
    const copy=res.clone(); caches.open(CACHE).then(c=>c.put(e.request,copy)); return res;
  }).catch(()=> caches.match(e.request).then(r=> r || caches.match('index.html'))));
});
