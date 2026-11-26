// SPDX-License-Identifier: GPL-3.0-or-later
// Offline shell: caches the app's own static files so the UI loads without
// a network connection. API and media requests are never cached.
// Bump CACHE_VERSION whenever app.js, lib.js, app.css, or index.html change.
const CACHE_VERSION = 'newpipe-web-v1';
const SHELL = [
  '/',
  '/index.html',
  '/app.js',
  '/lib.js',
  '/app.css',
  '/manifest.webmanifest',
  '/assets/new_pipe_icon_5.svg',
  '/assets/fonts/manrope-latin-wght-normal.woff2',
  '/assets/fonts/dm-sans-latin-wght-normal.woff2'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // API + media: network only.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put('/', copy));
          return response;
        })
        .catch(() => caches.match('/'))
    );
    return;
  }
  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request).then((response) => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
      }
      return response;
    }))
  );
});
