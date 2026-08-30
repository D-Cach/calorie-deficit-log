// Service worker: runs separately from the page, in the background, even
// when no tab is open — this is what makes offline support possible at all.
const CACHE_NAME = 'calorie-deficit-log-v6';
const APP_SHELL = [
  './',
  './index.html',
  './calc.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

// Fires once, the first time this service worker is installed on a device —
// pre-loads the app shell into the cache so there's already something to
// fall back to before the visitor has ever gone offline.
self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(APP_SHELL);
    })
  );
});

// Fires when a new service worker takes over from an older one — clears out
// any cache left behind by a previous CACHE_NAME so it doesn't sit around forever.
self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (cacheNames) {
      return Promise.all(
        cacheNames
          .filter(function (name) { return name !== CACHE_NAME; })
          .map(function (name) { return caches.delete(name); })
      );
    })
  );
});

// Network-first, not cache-first: always try to fetch the real, current page
// when online (so a code update shows up immediately, no stale-cache
// surprises), and only fall back to whatever's cached when the network
// request fails outright — i.e. no signal.
//
// { cache: 'no-store' } matters here specifically: a plain fetch() still
// honors the *browser's own* HTTP cache (the host sets a Cache-Control
// max-age on this site), so without this, "network-first" could still
// silently hand back a stale response while online — defeating the entire
// point of choosing network-first. This forces every fetch to actually hit
// the network, bypassing that layer (separate from — and not affecting —
// this service worker's own Cache Storage below, which is the real offline
// fallback).
self.addEventListener('fetch', function (event) {
  const req = event.request;
  const url = new URL(req.url);

  // Stay out of everything that isn't a same-origin GET for the app itself:
  //  - non-GET (Firestore/auth POSTs can't even be cache.put()),
  //  - cross-origin (the Firebase SDK on gstatic/googleapis),
  //  - Firebase's reserved /__/ paths — most importantly /__/auth/handler.
  //    A service worker intercepting the Google sign-in redirect navigation
  //    breaks the handshake intermittently, especially on iOS. Let it pass
  //    straight to the network, untouched.
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/__/')) {
    return;
  }

  event.respondWith(
    fetch(req, { cache: 'no-store' })
      .then(function (response) {
        const responseCopy = response.clone();
        caches.open(CACHE_NAME).then(function (cache) {
          cache.put(req, responseCopy);
        });
        return response;
      })
      .catch(function () {
        return caches.match(req);
      })
  );
});
