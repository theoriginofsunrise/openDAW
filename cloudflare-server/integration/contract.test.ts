// The app's storage handler against the real server code, in one process (no network, a fake bucket).
// Needs the monorepo checked out (it imports the handler from packages/studio/core).
import {beforeEach, describe, expect, it} from "vitest"
import worker from "../src/index"
import {issueSession} from "../src/auth"
import {Env} from "../src/types"
import {createGoogleSigner, FakeBucket, makeEnv} from "../src/testkit"
import {EchoCloudHandler, EchoPreconditionFailed, EchoSessionExpired} from "../../packages/studio/core/src/cloud/EchoCloudHandler"

const bytes = (...values: Array<number>) => new Uint8Array(values).buffer as ArrayBuffer
const text = (value: string) => new TextEncoder().encode(value).buffer as ArrayBuffer
const read = (buffer: ArrayBuffer) => new TextDecoder().decode(buffer)

describe("the app's handler and the server together", () => {
    let env: Env
    let bucket: FakeBucket
    let token: string
    let expired = 0
    const handlerFor = (sessionToken: string, limits?: { singleLimit?: number, partSize?: number }) =>
        new EchoCloudHandler("https://server.example", sessionToken,
            (input, init) => worker.fetch(new Request(input as string, {
                ...init,
                // a real request carries its length
                headers: {...(init?.headers as Record<string, string>), ...(init?.body instanceof ArrayBuffer
                    ? {"Content-Length": String(init.body.byteLength)} : typeof init?.body === "string"
                        ? {"Content-Length": String(new TextEncoder().encode(init.body).length)} : {})}
            }), env), () => {expired++}, limits)

    beforeEach(async () => {
        const signer = await createGoogleSigner()
        bucket = new FakeBucket()
        env = makeEnv(signer, bucket)
        token = (await issueSession(env, "me@example.com", Math.floor(Date.now() / 1000))).token
        expired = 0
    })

    it("is alive with a good login and not with a bad one", async () => {
        await expect(handlerFor(token).alive()).resolves.toBeUndefined()
        await expect(handlerFor("bad").alive()).rejects.toBeInstanceOf(EchoSessionExpired)
        expect(expired).toBe(1)
    })

    it("uploads, downloads, lists, checks and deletes like a cloud folder", async () => {
        const handler = handlerFor(token)
        await handler.upload("projects/p1/project.od", bytes(1, 2, 3))
        await handler.upload("projects/p1/meta.json", text("{\"name\":\"Song\"}"))
        await handler.upload("projects/p2/meta.json", text("{}"))
        expect(Array.from(new Uint8Array(await handler.download("projects/p1/project.od")))).toEqual([1, 2, 3])
        expect((await handler.list("projects/p1")).sort()).toEqual(["meta.json", "project.od"])
        expect((await handler.list("projects")).sort()).toEqual(["p1", "p2"])
        expect(await handler.exists("projects/p1")).toBe(true)
        expect(await handler.exists("projects/p1/meta.json")).toBe(true)
        expect(await handler.exists("projects/p3")).toBe(false)
        await handler.delete("projects/p1")
        expect(await handler.exists("projects/p1")).toBe(false)
        expect(await handler.exists("projects/p2")).toBe(true)
        await expect(handler.download("projects/p1/project.od")).rejects.toThrow("projects/p1/project.od")
    })

    it("sends names with spaces and special characters through unharmed", async () => {
        const handler = handlerFor(token)
        await handler.upload("presence/a b/c+d#e.json", text("note"))
        expect(read(await handler.download("presence/a b/c+d#e.json"))).toBe("note")
        expect(await handler.list("presence/a b")).toEqual(["c+d#e.json"])
    })

    it("sends a big file in parts and gets the same bytes back", async () => {
        const handler = handlerFor(token, {singleLimit: 100, partSize: 64})
        const big = new Uint8Array(300).map((_, index) => index % 251)
        await handler.upload("samples/big.wav", big.buffer as ArrayBuffer)
        expect(Array.from(new Uint8Array(await handler.download("samples/big.wav")))).toEqual(Array.from(big))
    })

    it("stops two devices from overwriting each other's catalog", async () => {
        const first = handlerFor(token)
        const second = handlerFor(token)
        await first.upload("projects/index.json", text("{}"))
        await first.download("projects/index.json")
        await second.download("projects/index.json")
        await second.upload("projects/index.json", text("{\"a\":1}"))
        // the first device still holds the old version: its write is refused instead of wiping the second one's work
        await expect(first.upload("projects/index.json", text("{\"b\":2}"))).rejects.toBeInstanceOf(EchoPreconditionFailed)
        expect(read(await second.download("projects/index.json"))).toBe("{\"a\":1}")
        // after reading the latest version again, the first device may write
        await first.download("projects/index.json")
        await first.upload("projects/index.json", text("{\"a\":1,\"b\":2}"))
        expect(read(await second.download("projects/index.json"))).toBe("{\"a\":1,\"b\":2}")
    })

    it("lets two devices write their own project files without checks", async () => {
        const first = handlerFor(token)
        const second = handlerFor(token)
        await first.upload("projects/p1/project.od", bytes(1))
        await second.download("projects/p1/project.od")
        await first.upload("projects/p1/project.od", bytes(2))
        await second.upload("projects/p1/project.od", bytes(3))
        expect(Array.from(new Uint8Array(await first.download("projects/p1/project.od")))).toEqual([3])
    })

    it("keeps two people's files apart", async () => {
        const mine = handlerFor(token)
        const other = handlerFor((await issueSession(env, "other@example.com", Math.floor(Date.now() / 1000))).token)
        await mine.upload("projects/index.json", text("mine"))
        expect(await other.exists("projects/index.json")).toBe(false)
        expect(await other.list("projects")).toEqual([])
    })
})
