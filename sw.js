const CACHE_NAME = 'ueberheld-cache-v13';
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
  './assets/models/Parrot.glb',
  './assets/models/Flamingo.glb',
  './assets/models/Horse.glb',
  './assets/textures/spark1.png',
  './assets/textures/circle.png',
  './assets/textures/snowflake2.png',
  './assets/textures/cloud.png',
  './vendor/three/three.module.min.js',
  './vendor/three/examples/jsm/loaders/GLTFLoader.js',
  './vendor/three/examples/jsm/loaders/OBJLoader.js',
  './vendor/three/examples/jsm/utils/BufferGeometryUtils.js',
  './vendor/three/examples/jsm/utils/SkeletonUtils.js',
  './vendor/three/examples/jsm/math/ImprovedNoise.js',
  './vendor/three/examples/jsm/postprocessing/EffectComposer.js',
  './vendor/three/examples/jsm/postprocessing/Pass.js',
  './vendor/three/examples/jsm/postprocessing/RenderPass.js',
  './vendor/three/examples/jsm/postprocessing/ShaderPass.js',
  './vendor/three/examples/jsm/postprocessing/MaskPass.js',
  './vendor/three/examples/jsm/postprocessing/UnrealBloomPass.js',
  './vendor/three/examples/jsm/postprocessing/OutputPass.js',
  './vendor/three/examples/jsm/shaders/CopyShader.js',
  './vendor/three/examples/jsm/shaders/LuminosityHighPassShader.js',
  './vendor/three/examples/jsm/shaders/OutputShader.js',
];

// The game code (HTML/JS/CSS) is small and changes with every deploy, so it is
// fetched network-first: players get a new version the moment they launch while
// online, instead of one launch later. Models and textures are large and rarely
// change, so those stay cache-first for fast starts and offline play.
const NETWORK_FIRST = /\.(?:html|js|css|json)$/;

function isNetworkFirst(request, url) {
  return request.mode === 'navigate' || url.pathname.endsWith('/') || NETWORK_FIRST.test(url.pathname);
}

async function networkFirst(request) {
  try {
    const fresh = await fetch(request);
    if (fresh && fresh.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, fresh.clone());
    }
    return fresh;
  } catch (err) {
    const cached = await caches.match(request);
    if (cached) return cached;
    throw err;
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const fresh = await fetch(request);
  if (fresh && fresh.ok) {
    const cache = await caches.open(CACHE_NAME);
    cache.put(request, fresh.clone());
  }
  return fresh;
}

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      // 'reload' bypasses the browser's own HTTP cache, otherwise a fresh
      // install can re-cache the very stale files it is meant to replace.
      cache.addAll(ASSETS.map(url => new Request(url, { cache: 'reload' })))
    ).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(isNetworkFirst(request, url) ? networkFirst(request) : cacheFirst(request));
});
