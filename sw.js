
const CACHE="vokabeltrainer-v36";
const ASSETS=["./","./index.html","./styles.css?v=36","./app.js?v=36","./manifest.webmanifest"];
self.addEventListener("install",e=>{self.skipWaiting();e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)))});
self.addEventListener("activate",e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener("fetch",e=>{
 if(e.request.mode==="navigate"){e.respondWith(fetch(e.request).catch(()=>caches.match("./index.html")));return}
 e.respondWith(fetch(e.request).then(r=>{let cp=r.clone();caches.open(CACHE).then(c=>c.put(e.request,cp));return r}).catch(()=>caches.match(e.request)))
});
