// Service Worker para Flashcards PWA
const CACHE_NAME = 'flashcards-v1';
const RUNTIME_CACHE = 'flashcards-runtime-v1';
const FIRESTORE_CACHE = 'flashcards-firestore-v1';

// Assets que devem estar sempre disponíveis offline
const ESSENTIAL_ASSETS = [
  '/',
  '/flashcards/',
  '/flashcards/index.html',
  '/flashcards/script.js',
  '/flashcards/style.css',
  'https://cdn.tailwindcss.com'
];

// Instalar o Service Worker
self.addEventListener('install', (event) => {
  console.log('[SW] Instalando Service Worker...');
  
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Cache aberto, adicionando assets essenciais');
      return cache.addAll(ESSENTIAL_ASSETS.filter(url => !url.includes('tailwind')));
    }).then(() => {
      // Pré-cachear Tailwind CSS
      return caches.open(CACHE_NAME).then(cache => {
        return fetch('https://cdn.tailwindcss.com')
          .then(response => {
            if (response.ok) {
              return cache.put('https://cdn.tailwindcss.com', response);
            }
          })
          .catch(() => {
            console.log('[SW] Tailwind CSS não disponível offline (esperado)');
          });
      });
    })
    .then(() => self.skipWaiting())
  );
});

// Ativar o Service Worker
self.addEventListener('activate', (event) => {
  console.log('[SW] Ativando Service Worker...');
  
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter(cacheName => {
            return cacheName !== CACHE_NAME && 
                   cacheName !== RUNTIME_CACHE && 
                   cacheName !== FIRESTORE_CACHE;
          })
          .map(cacheName => {
            console.log('[SW] Deletando cache obsoleto:', cacheName);
            return caches.delete(cacheName);
          })
      );
    })
    .then(() => self.clients.claim())
  );
});

// Estratégia de fetch
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Ignorar requisições não-GET
  if (request.method !== 'GET') {
    return;
  }

  // Ignorar requisições para chrome-extension
  if (url.protocol === 'chrome-extension:') {
    return;
  }

  // Firebase: Network First (prioritizar conexão)
  if (url.hostname.includes('firebaseapp.com') || 
      url.hostname.includes('firebasestorage.googleapis.com') ||
      url.hostname.includes('googleapis.com')) {
    return event.respondWith(networkFirstStrategy(request));
  }

  // Tailwind CSS: Cache First
  if (url.hostname === 'cdn.tailwindcss.com') {
    return event.respondWith(cacheFirstStrategy(request));
  }

  // Assets estáticos locais: Cache First
  if (url.pathname.endsWith('.js') || 
      url.pathname.endsWith('.css') || 
      url.pathname.endsWith('.html')) {
    return event.respondWith(cacheFirstStrategy(request));
  }

  // Tudo mais: Network First com fallback
  event.respondWith(networkFirstStrategy(request));
});

// Strategy: Cache First (cache, depois network)
async function cacheFirstStrategy(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  
  if (cached) {
    console.log('[SW] Cache hit:', request.url);
    return cached;
  }

  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    console.log('[SW] Fetch failed:', request.url, error);
    return new Response('Offline - Recurso não disponível', {
      status: 503,
      statusText: 'Service Unavailable',
      headers: new Headers({ 'Content-Type': 'text/plain' })
    });
  }
}

// Strategy: Network First (network, depois cache)
async function networkFirstStrategy(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  
  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    console.log('[SW] Network request failed, trying cache:', request.url);
    const cached = await cache.match(request);
    if (cached) {
      return cached;
    }
    
    // Fallback para resposta de erro offline
    return new Response(
      JSON.stringify({
        error: 'Você está offline',
        message: 'A conexão com a internet foi perdida. Dados offline serão sincronizados quando a conexão for restaurada.'
      }),
      {
        status: 503,
        statusText: 'Service Unavailable',
        headers: new Headers({ 'Content-Type': 'application/json' })
      }
    );
  }
}

// Mensagens do app para sincronização
self.addEventListener('message', (event) => {
  if (event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  
  if (event.data.type === 'CLEAR_CACHE') {
    caches.delete(RUNTIME_CACHE);
    caches.delete(FIRESTORE_CACHE);
  }
});

// Background Sync (sincronizar quando voltar online)
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-flashcards') {
    event.waitUntil(syncFlashcards());
  }
});

async function syncFlashcards() {
  try {
    console.log('[SW] Sincronizando flashcards...');
    // A sincronização será feita pelo script.js
    // Este é apenas um placeholder
  } catch (error) {
    console.error('[SW] Erro ao sincronizar:', error);
  }
}