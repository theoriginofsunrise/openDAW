// openDAW phone fork: offline app shell.
// "__BUILD__" is replaced with the build uuid at deploy time, so every deploy ships a new worker.
const BUILD = "__BUILD__"
const CACHE = `opendaw-${BUILD}`
// The studio build fingerprints its files with a uuid, e.g. main.<uuid>.js: those never change.
const FINGERPRINTED = /\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\./

// Download the whole app once (the list is written at build time), so the first offline launch works.
// A file that fails to download must never abort the install.
const precache = async () => {
    let urls
    try {
        urls = await (await fetch("/precache.json", {cache: "no-store"})).json()
    } catch (error) {
        return // no list (or no network): fall back to caching what gets used
    }
    const cache = await caches.open(CACHE)
    const queue = [...urls]
    const worker = async () => {
        for (let url = queue.shift(); url !== undefined; url = queue.shift()) {
            try {
                const response = await fetch(url, {cache: "reload"})
                if (response.ok && response.type === "basic" && !response.redirected) {await cache.put(url, response)}
            } catch (error) {
                // ignore, it will be fetched on demand
            }
        }
    }
    await Promise.all(Array.from({length: 6}, worker))
}

// No skipWaiting on purpose: a new version takes over on the next launch, so a session that is
// open never loses the lazy-loaded chunks of the version it started with.
self.addEventListener("install", event => event.waitUntil(precache()))

self.addEventListener("activate", event => event.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(keys.filter(key => key.startsWith("opendaw-") && key !== CACHE).map(key => caches.delete(key)))
    await self.clients.claim()
})()))

const store = async (key, response) => {
    // Only same-origin, complete responses. Cached responses keep their COOP/COEP headers.
    if (response.ok && response.type === "basic" && response.status === 200) {
        const cache = await caches.open(CACHE)
        await cache.put(key, response.clone())
    }
    return response
}

const cacheFirst = async request => {
    const cached = await caches.match(request)
    if (cached !== undefined) {return cached}
    return store(request, await fetch(request))
}

// Files that keep their name between builds: always try the network, fall back to the copy on the phone.
// The query string is dropped for the stored copy, the app adds timestamps like ?v=1794... to some requests.
const networkFirst = async request => {
    const url = new URL(request.url)
    const key = new Request(`${url.origin}${url.pathname}`)
    try {
        return await store(key, await fetch(request))
    } catch (error) {
        const cached = await caches.match(key)
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
    if (url.pathname.startsWith("/od-")) {return} // proxied samples, soundfonts, models: network only
    if (url.pathname === "/sw.js" || url.pathname === "/precache.json") {return}
    event.respondWith(FINGERPRINTED.test(url.pathname) ? cacheFirst(request) : networkFirst(request))
})
