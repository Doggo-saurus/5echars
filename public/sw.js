const OFFLINE_CACHE_VERSION = "v1";
const OFFLINE_CACHE_NAME = `fivee-offline-${OFFLINE_CACHE_VERSION}`;
const API_CACHE_NAME = `fivee-api-${OFFLINE_CACHE_VERSION}`;

async function loadOfflineAssetList() {
  const response = await fetch("/api/offline-assets", { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to load offline assets (${response.status})`);
  }
  const payload = await response.json();
  const assets = Array.isArray(payload?.assets) ? payload.assets : [];
  return assets.filter((asset) => typeof asset === "string" && asset.startsWith("/"));
}

async function installOfflineAssets() {
  const cache = await caches.open(OFFLINE_CACHE_NAME);
  const assets = await loadOfflineAssetList();
  await cache.addAll(assets);
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      await installOfflineAssets();
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name !== OFFLINE_CACHE_NAME && name !== API_CACHE_NAME)
          .map((name) => caches.delete(name))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("message", (event) => {
  if (event?.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

function isNavigationRequest(request) {
  return request.mode === "navigate";
}

function isApiCharacterRequest(url) {
  return url.pathname.startsWith("/api/characters");
}

function isCacheableAppRequest(url) {
  return (
    url.pathname === "/" ||
    url.pathname === "/index.html" ||
    url.pathname.startsWith("/src/") ||
    url.pathname.startsWith("/data/") ||
    url.pathname === "/manifest.webmanifest" ||
    url.pathname.startsWith("/icons/") ||
    url.pathname === "/JSON_FORMAT_REFERENCE" ||
    url.pathname === "/JSON_FORMAT_REFERENCE.md"
  );
}

function isFastUpdateRequest(url, request) {
  return (
    isNavigationRequest(request) ||
    url.pathname === "/" ||
    url.pathname === "/index.html" ||
    url.pathname.startsWith("/src/") ||
    url.pathname === "/manifest.webmanifest" ||
    url.pathname.startsWith("/icons/") ||
    url.pathname === "/JSON_FORMAT_REFERENCE" ||
    url.pathname === "/JSON_FORMAT_REFERENCE.md"
  );
}

function isCatalogDataRequest(url) {
  return url.pathname.startsWith("/data/");
}

async function handleApiRequest(request) {
  const cache = await caches.open(API_CACHE_NAME);
  try {
    const response = await fetch(request);
    if (request.method === "GET" && response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    if (request.method === "GET") {
      const cached = await cache.match(request);
      if (cached) return cached;
    }
    return new Response(
      JSON.stringify({
        error: "Offline: API unavailable",
        offline: true,
      }),
      {
        status: 503,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}

async function handleCacheFirst(request) {
  const cache = await caches.open(OFFLINE_CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    if (isNavigationRequest(request)) {
      const fallback = await cache.match("/");
      if (fallback) return fallback;
    }
    throw error;
  }
}

async function handleNetworkFirst(request) {
  const cache = await caches.open(OFFLINE_CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) return cached;
    if (isNavigationRequest(request)) {
      const fallback = await cache.match("/");
      if (fallback) return fallback;
    }
    throw error;
  }
}

async function handleStaleWhileRevalidate(request) {
  const cache = await caches.open(OFFLINE_CACHE_NAME);
  const cached = await cache.match(request);
  const networkPromise = fetch(request)
    .then((response) => {
      if (response.ok) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  if (cached) {
    return cached;
  }
  const networkResponse = await networkPromise;
  if (networkResponse) return networkResponse;
  throw new Error("Network and cache unavailable");
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (isApiCharacterRequest(url)) {
    event.respondWith(handleApiRequest(request));
    return;
  }

  if (isFastUpdateRequest(url, request)) {
    event.respondWith(handleNetworkFirst(request));
    return;
  }

  if (isCatalogDataRequest(url) || isCacheableAppRequest(url)) {
    event.respondWith(handleStaleWhileRevalidate(request));
  }
});
