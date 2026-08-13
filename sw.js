const APP_CACHE='kanji-trainer-app-v1';
const KANJI_CACHE='kanji-trainer-kanjivg-v1';

const APP_SHELL=[
  './',
  './index.html',
  './manifest.webmanifest',
  './apple-touch-icon.png',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install',event=>{
  event.waitUntil(
    caches.open(APP_CACHE)
      .then(cache=>cache.addAll(APP_SHELL))
      .then(()=>self.skipWaiting())
  );
});

self.addEventListener('activate',event=>{
  event.waitUntil(
    caches.keys().then(keys=>Promise.all(
      keys.filter(k=>![APP_CACHE,KANJI_CACHE].includes(k)).map(k=>caches.delete(k))
    )).then(()=>self.clients.claim())
  );
});

self.addEventListener('fetch',event=>{
  const req=event.request;
  if(req.method!=='GET') return;

  const url=new URL(req.url);

  // KanjiVG: once cached, use locally first.
  if(url.hostname==='raw.githubusercontent.com' &&
     url.pathname.includes('/KanjiVG/kanjivg/')){
    event.respondWith(
      caches.open(KANJI_CACHE).then(async cache=>{
        const cached=await cache.match(req);
        if(cached) return cached;
        try{
          const res=await fetch(req);
          if(res.ok) cache.put(req,res.clone());
          return res;
        }catch(err){
          return new Response('',{status:503,statusText:'Offline'});
        }
      })
    );
    return;
  }

  // Page navigation: prefer newest online copy, fall back to installed app.
  if(req.mode==='navigate'){
    event.respondWith(
      fetch(req)
        .then(res=>{
          const copy=res.clone();
          caches.open(APP_CACHE).then(cache=>cache.put('./index.html',copy));
          return res;
        })
        .catch(async()=>{
          const cache=await caches.open(APP_CACHE);
          return (await cache.match('./index.html')) || (await cache.match('./'));
        })
    );
    return;
  }

  // Same-origin static files.
  if(url.origin===self.location.origin){
    event.respondWith(
      caches.match(req).then(cached=>cached || fetch(req).then(res=>{
        if(res.ok){
          const copy=res.clone();
          caches.open(APP_CACHE).then(cache=>cache.put(req,copy));
        }
        return res;
      }))
    );
  }
});

self.addEventListener('message',event=>{
  if(event.data?.type!=='PRECACHE_KANJI' || !Array.isArray(event.data.urls)) return;

  const urls=[...new Set(event.data.urls)];
  event.waitUntil((async()=>{
    const cache=await caches.open(KANJI_CACHE);
    const queue=[...urls];

    // A few parallel workers so 200+ small SVGs cache quickly without hammering the network.
    const worker=async()=>{
      while(queue.length){
        const url=queue.shift();
        try{
          const already=await cache.match(url);
          if(already) continue;
          const res=await fetch(url,{cache:'reload'});
          if(res.ok) await cache.put(url,res.clone());
        }catch(e){}
      }
    };
    await Promise.all(Array.from({length:6},worker));
  })());
});
