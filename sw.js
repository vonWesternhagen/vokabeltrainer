const CACHE="vokabeltrainer-v45-stable1";
const ASSETS=["./","./index.html","./styles.css?v=45.1","./app.js?v=45.1","./manifest.webmanifest"];
self.addEventListener("install",event=>{
 event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting()))
});
self.addEventListener("activate",event=>{
 event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith("vokabeltrainer-")&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()))
});
self.addEventListener("fetch",event=>{
 if(event.request.method!=="GET"||new URL(event.request.url).origin!==self.location.origin)return;
 if(event.request.mode==="navigate"){
  event.respondWith(fetch(event.request).catch(()=>caches.match("./index.html")));return
 }
 const response=fetch(event.request);
 event.waitUntil(response.then(async result=>{
  if(result.ok){const copy=result.clone();const cache=await caches.open(CACHE);await cache.put(event.request,copy)}
 }).catch(()=>{}));
 event.respondWith(response.catch(()=>caches.match(event.request)))
});
