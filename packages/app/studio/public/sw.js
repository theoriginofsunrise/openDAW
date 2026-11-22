// openDAW phone fork: offline app shell.
// "__BUILD__" is replaced with the build uuid at deploy time, so every deploy ships a new worker.
const BUILD = "__BUILD__"
const CACHE = `opendaw-${BUILD}`

let listTotal = 0
let backgroundStarted = false

const listOf = async name => {
    try {
        const response = await fetch(name, {cache: "no-store"})
        return response.ok ? await response.json() : null
    } catch (error) {
        return null
    }
}

// Downloads files into this build's cache, skipping what is there. A file that fails never aborts the rest: it is
// fetched on demand later.
const download = async (urls, concurrency) => {
    const cache = await caches.open(CACHE)
    const queue = [...urls]
    const worker = async () => {
        for (let url = queue.shift(); url !== undefined; url = queue.shift()) {
            try {
                if (await cache.match(url) !== undefined) {continue}
                const response = await fetch(url, {cache: "reload"})
                if (response.ok && response.type === "basic" && !response.redirected) {await cache.put(url, response)}
            } catch (error) {
                // ignore, it will be fetched on demand
            }
        }
    }
    await Promise.all(Array.from({length: concurrency}, worker))
}

// Only what the start needs, so that a new version takes over within moments, also on a phone network. (It used to
// download the whole offline copy first, tens of megabytes: a phone could be interrupted halfway and start again.)
const installCritical = async () => {
    const critical = await listOf("/precache-critical.json")
    if (critical !== null) {
        await download(critical, 6)
        return
    }
    // a build without the short list: everything, as before
    const all = await listOf("/precache.json")
    if (all !== null) {
        listTotal = all.length
        await download(all, 6)
    }
}

// The rest of the offline copy, once the app is running and has what it needs: gently, three at a time.
const downloadTheRest = async () => {
    await new Promise(resolve => setTimeout(resolve, 10_000))
    const all = await listOf("/precache.json")
    if (all === null) {return}
    listTotal = all.length
    await download(all, 3)
}

// A new version takes over as soon as its first files are there. The open page keeps running the version it started
// with; the reload that the "new version" dialog asks for then loads the new one.
self.addEventListener("install", event => event.waitUntil(installCritical().then(() => self.skipWaiting())))

self.addEventListener("message", event => {
    const data = event.data
    // the page asks for the new build to take over right away (see AppUpdate.ts)
    if (data === "skip-waiting") {
        self.skipWaiting()
        return
    }
    // the page asks how far the offline copy is (the Information window)
    if (data !== null && typeof data === "object" && data.type === "status" && event.ports !== undefined && event.ports[0] !== undefined) {
        const port = event.ports[0]
        event.waitUntil((async () => {
            const cache = await caches.open(CACHE)
            const cached = (await cache.keys()).length
            if (listTotal === 0) {
                const all = await listOf("/precache.json")
                listTotal = all === null ? 0 : all.length
            }
            port.postMessage({build: BUILD, cached, total: listTotal})
        })())
    }
})

self.addEventListener("activate", event => event.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(keys.filter(key => key.startsWith("opendaw-") && key !== CACHE).map(key => caches.delete(key)))
    await self.clients.claim()
})()))

const store = async (request, response) => {
    // Only same-origin, complete responses. Cached responses keep their COOP/COEP headers.
    if (response.ok && response.type === "basic" && response.status === 200) {
        // keyed without the query string: the app adds timestamps like ?v=1794... to some requests
        const {origin, pathname} = new URL(request.url)
        const cache = await caches.open(CACHE)
        await cache.put(new Request(`${origin}${pathname}`), response.clone())
    }
    return response
}

// Every build has its own cache (see CACHE), so a copy on the phone always belongs to the build this worker
// shipped with: serving it first is both the fastest and the most consistent choice.
const cacheFirst = async request => {
    const cached = await caches.match(request, {ignoreSearch: true})
    if (cached !== undefined) {return cached}
    try {
        return await store(request, await fetch(request))
    } catch (error) {
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
    if (url.pathname === "/sw.js" || url.pathname === "/precache.json" || url.pathname === "/precache-critical.json") {return}
    if (!backgroundStarted) {
        backgroundStarted = true
        event.waitUntil(downloadTheRest())
    }
    event.respondWith(cacheFirst(request))
})
