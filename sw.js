const CACHE_NAME = 'ueberheld-cache-v4';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './state.js',
  './game.js',
  './ui.js',
  './manifest.json',
  './icon.svg',
  './assets/tree.obj',
  './assets/glow.png',
  './assets/ground_arcane.jpg',
  './assets/models/fox.glb',
  './vendor/three/three.module.min.js',
  './vendor/three/examples/jsm/loaders/GLTFLoader.js',
  './vendor/three/examples/jsm/loaders/OBJLoader.js',
  './vendor/three/examples/jsm/utils/BufferGeometryUtils.js',
  './vendor/three/examples/jsm/utils/SkeletonUtils.js',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).catch(() => cached);
    })
  );
});
