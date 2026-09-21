// ── SERVICE WORKER - Mis Finanzas PWA (v2.1) ──────────────────────────────────
// Sistema de versionado automático: cambia solo el número de versión al hacer deploy

const APP_VERSION = '2.2'; // CAMBIAR AQUÍ en cada deploy (2.1 → 2.2, etc)
const CACHE_NAME = `finanzas-v${APP_VERSION}`;
const ASSET_CACHE = `finanzas-assets-v${APP_VERSION}`;
const API_CACHE = `finanzas-api-v${APP_VERSION}`;

const CACHE_URLS = [
  '/mobile.html',
  '/index.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js'
];

// ── INSTALACIÓN: Cachear todos los recursos ────────────────────────────────────
self.addEventListener('install', event => {
  console.log(`[SW ${APP_VERSION}] Instalando service worker...`);
  
  event.waitUntil(
    Promise.all([
      // Cache principal (HTML, JS, CSS, iconos)
      caches.open(CACHE_NAME).then(cache => {
        return Promise.allSettled(
          CACHE_URLS.map(url => cache.add(url).catch(() => null))
        );
      }),
      // Limpiar caches antiguos durante instalación
      caches.keys().then(keys => {
        return Promise.all(
          keys
            .filter(k => k.startsWith('finanzas-') && k !== CACHE_NAME && k !== ASSET_CACHE && k !== API_CACHE)
            .map(k => {
              console.log(`[SW] Borrando cache antiguo: ${k}`);
              return caches.delete(k);
            })
        );
      })
    ]).then(() => {
      console.log(`[SW ${APP_VERSION}] Instalación completada`);
      self.skipWaiting(); // Activar inmediatamente sin esperar tabs
    })
  );
});

// ── ACTIVACIÓN: Limpiar caches viejos y tomar control ─────────────────────────
self.addEventListener('activate', event => {
  console.log(`[SW ${APP_VERSION}] Activando...`);
  
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys
          .filter(k => k.startsWith('finanzas-') && k !== CACHE_NAME && k !== ASSET_CACHE && k !== API_CACHE)
          .map(k => {
            console.log(`[SW] Borrando: ${k}`);
            return caches.delete(k);
          })
      );
    }).then(() => {
      console.log(`[SW ${APP_VERSION}] Listo. Cache activa: ${CACHE_NAME}`);
      self.clients.claim();
    })
  );
});

// ── FETCH: Estrategia inteligente de cache ─────────────────────────────────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  
  // 1. Supabase: SIEMPRE network (datos críticos, nunca desde cache)
  if (url.hostname.includes('supabase.co')) {
    event.respondWith(fetch(event.request));
    return;
  }
  
  // 2. HTML (documentos): cache-first, fallback a network
  if (event.request.destination === 'document') {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          if (response.ok && url.origin === self.location.origin) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        }).catch(() => new Response('Offline - página no disponible', {status: 503}));
      })
    );
    return;
  }
  
  // 3. Assets y todo lo demás: cache-first, fallback a network
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (response.ok && url.origin === self.location.origin) {
          const clone = response.clone();
          caches.open(ASSET_CACHE).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => new Response('Offline', {status: 503}));
    })
  );
});

// ── PUSH NOTIFICATIONS (para alertas de vencimientos) ──────────────────────────
self.addEventListener('push', event => {
  if (!event.data) return;
  
  try {
    const data = event.data.json();
    event.waitUntil(
      self.registration.showNotification(data.title || 'Mis Finanzas', {
        body: data.body || '',
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-72.png',
        vibrate: [200, 100, 200],
        data: { url: data.url || '/mobile.html' }
      })
    );
  } catch (e) {
    console.log('[SW] Error en push:', e);
  }
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.openWindow(event.notification.data.url || '/mobile.html')
  );
});

// ── MESSAGE: Comunicación con el cliente ───────────────────────────────────────
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    console.log('[SW] Saltando espera, activando nueva versión');
    self.skipWaiting();
  }
  
  if (event.data && event.data.type === 'GET_VERSION') {
    event.ports[0].postMessage({ version: APP_VERSION });
  }
});
