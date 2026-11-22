import {describe, expect, it} from "vitest"
import {readFileSync} from "node:fs"
import {resolve} from "node:path"
import {runInNewContext} from "node:vm"

// Runs public/sw.js itself, with a pretend browser around it: the cache, the network, the events.
const source = readFileSync(resolve(__dirname, "../public/sw.js"), "utf8").replaceAll("__BUILD__", "abc123def456")
const Origin = "https://app.example"

type FakeResponse = { ok: boolean, status: number, type: string, redirected: boolean, body: string, json(): Promise<unknown>, clone(): FakeResponse }

const answer = (body: string, status = 200): FakeResponse => {
    const response: FakeResponse = {
        ok: status >= 200 && status < 300, status, type: "basic", redirected: false, body,
        json: async () => JSON.parse(body), clone: () => response
    }
    return response
}

const pathOf = (key: unknown): string => new URL(typeof key === "string" ? key : (key as { url: string }).url, Origin).pathname

const load = (files: Record<string, string>, options: { failing?: Array<string>, existing?: Record<string, Array<string>> } = {}) => {
    const listeners = new Map<string, (event: any) => void>()
    const stores = new Map<string, Map<string, FakeResponse>>()
    Object.entries(options.existing ?? {}).forEach(([name, paths]) => stores.set(name, new Map(paths.map(path => [path, answer("old")]))))
    const fetched: Array<string> = []
    let running = 0
    let mostAtOnce = 0
    const timers: Array<() => void> = []
    const counts = {skipWaiting: 0, claim: 0}
    const cacheNamed = (name: string) => {
        if (!stores.has(name)) {stores.set(name, new Map())}
        const store = stores.get(name) as Map<string, FakeResponse>
        return {
            match: async (key: unknown) => store.get(pathOf(key)),
            put: async (key: unknown, response: FakeResponse) => {store.set(pathOf(key), response)},
            keys: async () => [...store.keys()]
        }
    }
    const caches = {
        open: async (name: string) => cacheNamed(name),
        keys: async () => [...stores.keys()],
        delete: async (name: string) => stores.delete(name),
        match: async (key: unknown) => {
            for (const store of stores.values()) {
                const found = store.get(pathOf(key))
                if (found !== undefined) {return found}
            }
            return undefined
        }
    }
    const fetchStub = async (input: unknown): Promise<FakeResponse> => {
        const path = pathOf(input)
        fetched.push(path)
        running++
        mostAtOnce = Math.max(mostAtOnce, running)
        await Promise.resolve()
        running--
        if (options.failing?.includes(path)) {throw new Error("network")}
        const body = files[path]
        return body === undefined ? answer("", 404) : answer(body)
    }
    const self = {
        addEventListener: (type: string, handler: (event: any) => void) => {listeners.set(type, handler)},
        skipWaiting: () => {counts.skipWaiting++},
        clients: {claim: async () => {counts.claim++}},
        location: {origin: Origin}
    }
    runInNewContext(source, {
        self, caches, fetch: fetchStub, URL, Request, Promise, console,
        setTimeout: (callback: () => void) => {timers.push(callback)}
    })
    const dispatch = (type: string, event: Record<string, unknown> = {}) => {
        const waiting: Array<Promise<unknown>> = []
        listeners.get(type)?.({...event, waitUntil: (promise: Promise<unknown>) => {waiting.push(promise)}})
        return Promise.all(waiting)
    }
    return {dispatch, stores, fetched, counts, timers, mostAtOnce: () => mostAtOnce, listeners}
}

const siteFiles: Record<string, string> = {
    "/precache-critical.json": JSON.stringify(["/", "/assets/index.js", "/assets/index.css"]),
    "/precache.json": JSON.stringify(["/", "/assets/index.js", "/assets/index.css", "/engine.wasm", "/big.js", "/more.js"]),
    "/": "<html>", "/assets/index.js": "js", "/assets/index.css": "css", "/engine.wasm": "wasm", "/big.js": "big", "/more.js": "more"
}

const fetchRequest = (path: string, extra: Record<string, unknown> = {}) => ({
    request: {url: `${Origin}${path}`, method: "GET", headers: {has: () => false}, mode: "no-cors", ...extra}
})

// Asks the worker for a file: what it answers (if it takes the request at all) and the work it keeps going afterwards.
const ask = (worker: ReturnType<typeof load>, path: string, extra: Record<string, unknown> = {}) => {
    let answered: Promise<FakeResponse> | undefined = undefined
    const background: Array<Promise<unknown>> = []
    worker.listeners.get("fetch")?.({
        ...fetchRequest(path, extra),
        respondWith: (promise: Promise<FakeResponse>) => {answered = promise},
        waitUntil: (promise: Promise<unknown>) => {background.push(promise)}
    })
    return {taken: answered !== undefined, answer: answered as Promise<FakeResponse> | undefined, background}
}

describe("service worker: installing", () => {
    it("downloads only what the start needs, then takes over", async () => {
        const worker = load(siteFiles)
        await worker.dispatch("install")
        expect(worker.counts.skipWaiting).toBe(1)
        const cached = [...(worker.stores.get("opendaw-abc123def456") as Map<string, unknown>).keys()].sort()
        expect(cached).toEqual(["/", "/assets/index.css", "/assets/index.js"])
        expect(worker.fetched).not.toContain("/engine.wasm")
        expect(worker.fetched).not.toContain("/big.js")
        expect(worker.fetched).not.toContain("/precache.json")
    })

    it("does not wait for the rest before taking over", async () => {
        const worker = load(siteFiles)
        let tookOver = false
        const done = worker.dispatch("install").then(() => {tookOver = true})
        await done
        expect(tookOver).toBe(true)
        expect(worker.timers).toHaveLength(0)
    })

    it("still takes over when one of the files does not arrive", async () => {
        const worker = load(siteFiles, {failing: ["/assets/index.css"]})
        await worker.dispatch("install")
        expect(worker.counts.skipWaiting).toBe(1)
        const cached = [...(worker.stores.get("opendaw-abc123def456") as Map<string, unknown>).keys()].sort()
        expect(cached).toEqual(["/", "/assets/index.js"])
    })

    it("downloads everything, as it used to, for a build that has no short list", async () => {
        const {"/precache-critical.json": _skipped, ...withoutShortList} = siteFiles
        const worker = load(withoutShortList)
        await worker.dispatch("install")
        expect(worker.counts.skipWaiting).toBe(1)
        expect((worker.stores.get("opendaw-abc123def456") as Map<string, unknown>).size).toBe(6)
    })

    it("takes over even when no list can be read (no network at all)", async () => {
        const worker = load({})
        await worker.dispatch("install")
        expect(worker.counts.skipWaiting).toBe(1)
    })
})

describe("service worker: the rest of the offline copy", () => {
    it("starts when the app starts asking for files, once, and after a pause", async () => {
        const worker = load(siteFiles)
        await worker.dispatch("install")
        const first = ask(worker, "/")
        expect(first.background).toHaveLength(1)
        expect(worker.timers).toHaveLength(1)
        expect(worker.fetched).not.toContain("/engine.wasm")
        const second = ask(worker, "/assets/other.js")
        expect(second.background).toHaveLength(0)
        expect(worker.timers).toHaveLength(1)
    })

    it("downloads what is missing, three at a time, and skips what is there", async () => {
        const worker = load(siteFiles)
        await worker.dispatch("install")
        const first = ask(worker, "/")
        await first.answer
        worker.timers[0]()
        await Promise.all(first.background)
        const cached = [...(worker.stores.get("opendaw-abc123def456") as Map<string, unknown>).keys()].sort()
        expect(cached).toEqual(["/", "/assets/index.css", "/assets/index.js", "/big.js", "/engine.wasm", "/more.js"])
        expect(worker.fetched.filter(path => path === "/assets/index.js")).toHaveLength(1) // not downloaded twice
        expect(worker.mostAtOnce()).toBeLessThanOrEqual(3)
    })

    it("does not mind when the full list cannot be read", async () => {
        const {"/precache.json": _skipped, ...withoutFullList} = siteFiles
        const worker = load(withoutFullList)
        await worker.dispatch("install")
        const first = ask(worker, "/")
        worker.timers[0]()
        await expect(Promise.all(first.background)).resolves.toBeDefined()
    })
})

describe("service worker: messages", () => {
    it("takes over when the page says so", async () => {
        const worker = load(siteFiles)
        await worker.dispatch("message", {data: "skip-waiting"})
        expect(worker.counts.skipWaiting).toBe(1)
    })

    it("tells how far the offline copy is", async () => {
        const worker = load(siteFiles)
        await worker.dispatch("install")
        const replies: Array<unknown> = []
        await worker.dispatch("message", {data: {type: "status"}, ports: [{postMessage: (reply: unknown) => replies.push(reply)}]})
        expect(replies).toEqual([{build: "abc123def456", cached: 3, total: 6}])
    })

    it("ignores a status question that has nowhere to answer, and other messages", async () => {
        const worker = load(siteFiles)
        await worker.dispatch("message", {data: {type: "status"}})
        await worker.dispatch("message", {data: "hello"})
        await worker.dispatch("message", {data: null})
        expect(worker.counts.skipWaiting).toBe(0)
    })
})

describe("service worker: activating", () => {
    it("removes the caches of other builds, and nobody else's, and takes control of the open pages", async () => {
        const worker = load(siteFiles, {existing: {"opendaw-old": ["/"], "opendaw-abc123def456": ["/"], "somebody-else": ["/x"]}})
        await worker.dispatch("activate")
        expect([...worker.stores.keys()].sort()).toEqual(["opendaw-abc123def456", "somebody-else"])
        expect(worker.counts.claim).toBe(1)
    })
})

describe("service worker: answering requests", () => {
    it("leaves other websites, proxied files, plug-ins and its own files to the network", async () => {
        const worker = load(siteFiles)
        for (const path of ["/od-assets/x.wav", "/od-api/list", "/wclap/frame.html", "/sw.js", "/precache.json", "/precache-critical.json"]) {
            expect(ask(worker, path).taken).toBe(false)
        }
        expect(ask(worker, "/x", {url: "https://elsewhere.example/x"}).taken).toBe(false)
        expect(ask(worker, "/x", {method: "POST"}).taken).toBe(false)
        expect(ask(worker, "/x", {headers: {has: (name: string) => name === "range"}}).taken).toBe(false)
        expect(worker.timers).toHaveLength(0)
    })

    it("answers from the cache first, and keeps what it had to fetch (without the query)", async () => {
        const worker = load(siteFiles)
        await worker.dispatch("install")
        const known = await ask(worker, "/assets/index.js?v=123").answer
        expect(known?.body).toBe("js")
        const fetchedBefore = worker.fetched.length
        const fresh = await ask(worker, "/engine.wasm?v=9").answer
        expect(fresh?.body).toBe("wasm")
        expect(worker.fetched.length).toBeGreaterThan(fetchedBefore)
        const again = await ask(worker, "/engine.wasm").answer
        expect(again?.body).toBe("wasm")
        expect(worker.fetched.filter(path => path === "/engine.wasm")).toHaveLength(1)
    })

    it("falls back to the cached page when the network is gone", async () => {
        const worker = load(siteFiles, {failing: ["/some/page"]})
        await worker.dispatch("install")
        const navigation = await ask(worker, "/some/page", {mode: "navigate"}).answer
        expect(navigation?.body).toBe("<html>")
    })
})
