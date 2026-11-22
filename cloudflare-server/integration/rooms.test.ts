// The live rooms on Cloudflare's local Workers runtime (wrangler dev): the same y-websocket client the app uses, the
// peer-to-peer go-between, and the access rules. Only when ECHO_INTEGRATION=1 and WRANGLER_BIN points at wrangler.
import {afterAll, beforeAll, describe, expect, it} from "vitest"
import {ChildProcess, spawn} from "node:child_process"
import {mkdtempSync, rmSync, writeFileSync} from "node:fs"
import {tmpdir} from "node:os"
import {join, resolve} from "node:path"
import WebSocket from "ws"
import * as Y from "yjs"
import {WebsocketProvider} from "y-websocket"
import {removeAwarenessStates} from "y-protocols/awareness"
import {ClientId, createGoogleSigner, goodClaims} from "../src/testkit"

const enabled = process.env.ECHO_INTEGRATION === "1" && process.env.WRANGLER_BIN !== undefined
const Port = 8798
const Http = `http://127.0.0.1:${Port}`
const Ws = `ws://127.0.0.1:${Port}`
const Origin = "https://echo-says-echo.pages.dev"

const until = async (condition: () => boolean, what: string, ms = 8000) => {
    const deadline = Date.now() + ms
    while (!condition()) {
        if (Date.now() > deadline) {throw new Error(`timeout: ${what}`)}
        await new Promise(resolve => setTimeout(resolve, 25))
    }
}

describe.skipIf(!enabled)("live rooms on the local Workers runtime", () => {
    const root = resolve(__dirname, "..")
    const devVars = join(root, ".dev.vars")
    const state = mkdtempSync(join(tmpdir(), "echo-rooms-"))
    let server: ChildProcess
    let token = ""
    const logs: Array<string> = []
    const providers: Array<WebsocketProvider> = []

    const join_ = (room: string, doc: Y.Doc, withToken: string = token) => {
        const provider = new WebsocketProvider(Ws, room, doc, {
            WebSocketPolyfill: WebSocket as never, params: withToken === "" ? {} : {token: withToken}, connect: true
        })
        providers.push(provider)
        return provider
    }

    beforeAll(async () => {
        const signer = await createGoogleSigner()
        writeFileSync(devVars, [
            `GOOGLE_CLIENT_ID=${ClientId}`, "ALLOWED_EMAILS=me@example.com,friend@example.com", `ALLOWED_ORIGINS=${Origin}`,
            "SESSION_SECRET=integration-secret-0123456789abcdef", `JWKS_OVERRIDE=${signer.jwks}`
        ].join("\n"))
        server = spawn(process.env.WRANGLER_BIN as string,
            ["dev", "--local", "--ip", "127.0.0.1", "--port", String(Port), "--persist-to", state],
            {cwd: root, env: {...process.env, CI: "true", WRANGLER_SEND_METRICS: "false"}})
        server.stdout?.on("data", chunk => logs.push(String(chunk)))
        server.stderr?.on("data", chunk => logs.push(String(chunk)))
        const deadline = Date.now() + 120_000
        while (Date.now() < deadline) {
            if (await fetch(`${Http}/`).then(response => response.ok, () => false)) {break}
            await new Promise(resolve => setTimeout(resolve, 500))
        }
        const login = async (email: string) => {
            const idToken = await signer.sign(goodClaims(Math.floor(Date.now() / 1000), {email}))
            const response = await fetch(`${Http}/auth/google`, {method: "POST", body: JSON.stringify({idToken, nonce: "n-123"})})
            expect(response.status, logs.join("")).toBe(200)
            return ((await response.json()) as { token: string }).token
        }
        token = await login("me@example.com")
    }, 150_000)

    afterAll(() => {
        providers.forEach(provider => provider.destroy())
        server?.kill("SIGTERM")
        rmSync(devVars, {force: true})
        rmSync(state, {recursive: true, force: true})
    })

    it("syncs a project between two people in a room, both ways", async () => {
        const a = new Y.Doc()
        const b = new Y.Doc()
        const pa = join_("room-sync", a)
        const pb = join_("room-sync", b)
        await until(() => pa.synced && pb.synced, "both synced")
        a.getMap("boxes").set("box-1", "from a")
        await until(() => b.getMap("boxes").get("box-1") === "from a", "a to b")
        b.getMap("boxes").set("box-2", "from b")
        await until(() => a.getMap("boxes").get("box-2") === "from b", "b to a")
    }, 30_000)

    it("gives a latecomer what is already in the room", async () => {
        const a = new Y.Doc()
        const pa = join_("room-late", a)
        await until(() => pa.synced, "a synced")
        a.getMap("boxes").set("song", "first")
        a.getMap("boxes").set("beat", "second")
        await new Promise(resolve => setTimeout(resolve, 300))
        const c = new Y.Doc()
        const pc = join_("room-late", c)
        await until(() => pc.synced && c.getMap("boxes").size === 2, "latecomer has both")
        expect(c.getMap("boxes").get("song")).toBe("first")
    }, 30_000)

    it("keeps rooms apart", async () => {
        const a = new Y.Doc()
        const b = new Y.Doc()
        const pa = join_("room-one", a)
        const pb = join_("room-two", b)
        await until(() => pa.synced && pb.synced, "synced")
        a.getMap("boxes").set("x", 1)
        await new Promise(resolve => setTimeout(resolve, 500))
        expect(b.getMap("boxes").size).toBe(0)
    }, 30_000)

    // The app does this when its page is hidden or closed (StudioLiveRoomConnect, "pagehide"). A person who drops out
    // without it (a lost network) disappears after the 30 seconds the awareness protocol allows.
    it("shows who is in the room, and takes them off when they leave", async () => {
        const a = new Y.Doc()
        const b = new Y.Doc()
        const pa = join_("room-aware", a)
        const pb = join_("room-aware", b)
        await until(() => pa.synced && pb.synced, "synced")
        pa.awareness.setLocalState({user: "Ada"})
        pb.awareness.setLocalState({user: "Bob"})
        await until(() => pb.awareness.getStates().size === 2 && pa.awareness.getStates().size === 2, "both see both")
        removeAwarenessStates(pb.awareness, [pb.awareness.clientID], "pagehide")
        await until(() => pa.awareness.getStates().size === 1, "bob is gone")
        pb.destroy()
    }, 30_000)

    it("refuses someone who is not signed in, with a bad token, or from another website", async () => {
        const attempt = (url: string, headers: Record<string, string> = {}) => new Promise<number>(resolve => {
            const socket = new WebSocket(url, {headers})
            socket.on("unexpected-response", (_request, response) => resolve(response.statusCode ?? 0))
            socket.on("open", () => {
                socket.close()
                resolve(101)
            })
            socket.on("error", () => {})
        })
        expect(await attempt(`${Ws}/room-private`)).toBe(401)
        expect(await attempt(`${Ws}/room-private?token=garbage`)).toBe(401)
        expect(await attempt(`${Ws}/room-private?token=${token}`, {Origin: "https://evil.example"})).toBe(403)
        expect(await attempt(`${Ws}/room-private?token=${token}`, {Origin})).toBe(101)
        expect(await attempt(`${Ws}/signaling`)).toBe(401)
        expect(await attempt(`${Ws}/signaling?token=${token}`, {Origin})).toBe(101)
        expect(await attempt(`${Ws}/?token=${token}`)).toBe(400)
    }, 30_000)

    it("passes messages between the people on a topic, and answers a ping", async () => {
        const open = (name: string) => new Promise<WebSocket>(resolve => {
            const socket = new WebSocket(`${Ws}/signaling?token=${token}`)
            socket.on("open", () => resolve(socket))
            void name
        })
        const [one, two, three] = await Promise.all([open("one"), open("two"), open("three")])
        const received: Record<string, Array<string>> = {one: [], two: [], three: []}
        one.on("message", data => received.one.push(String(data)))
        two.on("message", data => received.two.push(String(data)))
        three.on("message", data => received.three.push(String(data)))
        one.send(JSON.stringify({type: "subscribe", topics: ["follow:room-x"]}))
        two.send(JSON.stringify({type: "subscribe", topics: ["follow:room-x"]}))
        three.send(JSON.stringify({type: "subscribe", topics: ["follow:other"]}))
        await new Promise(resolve => setTimeout(resolve, 300))
        one.send(JSON.stringify({type: "publish", topic: "follow:room-x", data: {position: 42}}))
        await until(() => received.two.length === 1, "two heard one")
        expect(JSON.parse(received.two[0])).toMatchObject({type: "publish", topic: "follow:room-x", data: {position: 42}})
        await new Promise(resolve => setTimeout(resolve, 300))
        expect(received.one).toEqual([]) // not back to the sender
        expect(received.three).toEqual([]) // not another topic
        two.send(JSON.stringify({type: "unsubscribe", topics: ["follow:room-x"]}))
        await new Promise(resolve => setTimeout(resolve, 200))
        one.send(JSON.stringify({type: "publish", topic: "follow:room-x", data: {position: 43}}))
        await new Promise(resolve => setTimeout(resolve, 300))
        expect(received.two.length).toBe(1)
        one.send(JSON.stringify({type: "ping"}))
        await until(() => received.one.some(text => JSON.parse(text).type === "pong"), "pong")
        ;[one, two, three].forEach(socket => socket.close())
    }, 30_000)
})
