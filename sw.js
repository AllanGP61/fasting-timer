'use strict';

const CACHE = 'fasting-timer-v3';
const NETWORK_TIMEOUT_MS = 3000;
const APP_FILES = [
  './',
  'index.html',
  'style.css',
  'app.js',
  'onedrive.js',
  'mood.js',
  'manifest.webmanifest',
  'icons/apple-touch-icon.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(APP_FILES.map((file) => new Request(file, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(networkFirst(event, request));
});

// Microsoft sends the browser back to the app with a one-time ?code=... in the address; never save those.
function isSignInReturn(request) {
  const params = new URL(request.url).searchParams;
  return params.has('code') || params.has('error');
}

// After one request times out, skip the wait for the next 30 seconds so the CSS and
// JS files don't each add their own 3-second delay to the same page load.
const SLOW_NETWORK_MEMORY_MS = 30000;
let slowNetworkUntil = 0;

// Try the network for up to 3 seconds, otherwise serve the saved copy.
// A slow network request keeps running so the saved copy is refreshed for next time.
async function networkFirst(event, request) {
  const cache = await caches.open(CACHE);

  // GitHub Pages lets the browser keep files for 10 minutes; 'no-cache' makes it check for a newer copy every
  // time (a quick "unchanged" reply when nothing changed) so a new deploy never mixes with older saved files.
  const network = fetch(new Request(request.url, { cache: 'no-cache' })).then((response) => {
    if (response.ok && !isSignInReturn(request)) cache.put(request, response.clone());
    return response;
  });
  event.waitUntil(network.catch(() => {}));

  if (Date.now() < slowNetworkUntil) {
    const saved = await cache.match(request, { ignoreSearch: true });
    if (saved) return saved;
  }

  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      slowNetworkUntil = Date.now() + SLOW_NETWORK_MEMORY_MS;
      reject(new Error('network timeout'));
    }, NETWORK_TIMEOUT_MS);
  });

  try {
    return await Promise.race([network, timeout]);
  } catch (err) {
    const saved = await cache.match(request, { ignoreSearch: true });
    return saved || network;
  } finally {
    clearTimeout(timer);
  }
}
