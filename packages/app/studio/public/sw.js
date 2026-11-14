// openDAW phone fork: offline app shell.
// "__BUILD__" is replaced with the build uuid at deploy time, so every deploy ships a new worker.
const BUILD = "__BUILD__"
const CACHE = `opendaw-${BUILD}`
// The studio build fingerprints its files with a uuid, e.g. main.<uuid>.js: those never change.
const FINGERPRINTED = /\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\./

// No skipWaiting on purpose: a new version takes over on the next launch, so a session that is
// open never loses the lazy-loaded chunks of the version it started with.
self.addEventListener("activate", event => event.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(keys.filter(key => key.startsWith("opendaw-") && key !== CACHE).map(key => caches.delete(key)))
    await self.clients.claim()
})()))

const store = async (request, response) => {
    // Only same-origin, complete responses. Cached responses keep their COOP/COEP headers.
    if (response.ok && response.type === "basic" && response.status === 200) {
        const cache = await caches.open(CACHE)
        await cache.put(request, response.clone())
    }
    return response
}

const cacheFirst = async request => {
    const cached = await caches.match(request)
    if (cached !== undefined) {return cached}
    return store(request, await fetch(request))
}

const networkFirst = async request => {
    try {
        return await store(request, await fetch(request))
    } catch (error) {
        const cached = await caches.match(request)
        if (cached !== undefined) {return cached}
        if (request.mode === "navigate") {
            const shell = await caches.match("/")
            if (shell !== undefined) {return shell}
        }
        throw error
    }
}

self.addEventListener("fetch", event => {
    const request = event.request
    if (request.method !== "GET" || request.headers.has("range")) {return}
    const url = new URL(request.url)
    if (url.origin !== self.location.origin) {return} // samples, soundfonts, cloud APIs: network only
    if (url.pathname.startsWith("/wclap")) {return} // plugin frame has its own worker and scope
    if (url.pathname.endsWith("/build-info.json") || url.pathname === "/sw.js") {return}
    event.respondWith(FINGERPRINTED.test(url.pathname) ? cacheFirst(request) : networkFirst(request))
})
