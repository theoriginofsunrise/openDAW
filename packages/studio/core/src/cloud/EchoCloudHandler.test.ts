import {describe, expect, it} from "vitest"
import {Errors} from "@opendaw/lib-std"
import {EchoCloudHandler, EchoPreconditionFailed, EchoSessionExpired, isSharedFile} from "./EchoCloudHandler"

type Call = { url: string, init: RequestInit }

const create = (respond: (call: Call) => Response, limits?: { singleLimit?: number, partSize?: number }) => {
    const calls: Array<Call> = []
    let ended = 0
    const handler = new EchoCloudHandler("https://server.example/", "token-1", async (input, init = {}) => {
        const call = {url: String(input), init}
        calls.push(call)
        return respond(call)
    }, () => {ended++}, limits)
    return {handler, calls, ended: () => ended}
}
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), {status, headers})
const header = (call: Call, name: string) => (call.init.headers as Record<string, string>)[name]

describe("EchoCloudHandler", () => {
    it("knows which files every device shares", () => {
        expect(isSharedFile("projects/index.json")).toBe(true)
        expect(isSharedFile("samples/index.json")).toBe(true)
        expect(isSharedFile("projects/tombstones.json")).toBe(true)
        expect(isSharedFile("samples/structure.json")).toBe(true)
        expect(isSharedFile("projects/abc/meta.json")).toBe(false)
        expect(isSharedFile("projects/abc/project.od")).toBe(false)
        expect(isSharedFile("presence/abc/session.json")).toBe(false)
    })

    it("sends the login with every request and encodes every part of a path", async () => {
        const {handler, calls} = create(() => json({etag: "e1"}))
        await handler.upload("projects/my song/a+b#1.od", new ArrayBuffer(3))
        expect(calls[0].url).toBe("https://server.example/files/projects/my%20song/a%2Bb%231.od")
        expect(header(calls[0], "Authorization")).toBe("Bearer token-1")
        expect(calls[0].init.method).toBe("PUT")
    })

    it("checks the answer of the server and turns 404 into 'file not found'", async () => {
        const {handler} = create(call => call.url.endsWith("/missing.od") ? json({error: "not_found"}, 404) : new Response(new Uint8Array([7, 8]), {status: 200}))
        await expect(handler.download("a/missing.od")).rejects.toBeInstanceOf(Errors.FileNotFound)
        expect(Array.from(new Uint8Array(await handler.download("a/there.od")))).toEqual([7, 8])
    })

    it("tells whether a file exists", async () => {
        const {handler, calls} = create(call => new Response(null, {status: call.url.endsWith("/yes") ? 200 : 404}))
        expect(await handler.exists("a/yes")).toBe(true)
        expect(await handler.exists("a/no")).toBe(false)
        expect(calls[0].init.method).toBe("HEAD")
    })

    it("lists a folder, and the root", async () => {
        const {handler, calls} = create(() => json({names: ["a", "b"]}))
        expect(await handler.list("projects/p 1")).toEqual(["a", "b"])
        expect(calls[0].url).toBe("https://server.example/list?path=projects%2Fp%201")
        await handler.list()
        expect(calls[1].url).toBe("https://server.example/list?path=")
    })

    it("deletes", async () => {
        const {handler, calls} = create(() => json({ok: true}))
        await handler.delete("projects/p1")
        expect(calls[0].init.method).toBe("DELETE")
        expect(calls[0].url).toBe("https://server.example/files/projects/p1")
    })

    it("fails loudly on a server error", async () => {
        const {handler} = create(() => new Response("boom", {status: 500}))
        await expect(handler.upload("a.od", new ArrayBuffer(1))).rejects.toThrow("500")
        await expect(handler.download("a.od")).rejects.toThrow("500")
        await expect(handler.list("a")).rejects.toThrow("500")
        await expect(handler.delete("a")).rejects.toThrow("500")
        await expect(handler.alive()).rejects.toThrow("500")
    })

    it("is alive when the server knows the login", async () => {
        const {handler, calls} = create(() => json({email: "me@example.com"}))
        await expect(handler.alive()).resolves.toBeUndefined()
        expect(calls[0].url).toBe("https://server.example/auth/me")
    })

    it("ends the login and says so when the server does not accept it", async () => {
        const {handler, ended} = create(() => json({error: "unauthorized"}, 401))
        await expect(handler.download("a.od")).rejects.toBeInstanceOf(EchoSessionExpired)
        await expect(handler.alive()).rejects.toBeInstanceOf(EchoSessionExpired)
        expect(ended()).toBe(2)
    })

    describe("shared files", () => {
        it("only overwrites the version it last read", async () => {
            const {handler, calls} = create(call => call.init.method === "PUT"
                ? json({etag: "e2"}) : new Response("{}", {status: 200, headers: {ETag: "\"e1\""}}))
            await handler.upload("projects/index.json", new ArrayBuffer(2))
            expect(header(calls[0], "X-Echo-If-Match")).toBeUndefined()
            await handler.download("projects/index.json")
            await handler.upload("projects/index.json", new ArrayBuffer(2))
            expect(header(calls[2], "X-Echo-If-Match")).toBe("e1")
            await handler.upload("projects/index.json", new ArrayBuffer(2))
            expect(header(calls[3], "X-Echo-If-Match")).toBe("e2")
        })

        it("says so when somebody else changed the file in between", async () => {
            const {handler} = create(call => call.init.method === "PUT"
                ? json({error: "precondition_failed"}, 412) : new Response("{}", {status: 200, headers: {ETag: "\"e1\""}}))
            await handler.download("projects/index.json")
            const failure = await handler.upload("projects/index.json", new ArrayBuffer(2)).catch(error => error)
            expect(failure).toBeInstanceOf(EchoPreconditionFailed)
            expect(failure.message).toContain("projects/index.json")
        })

        it("does not check ordinary files (a project, a sample)", async () => {
            const {handler, calls} = create(call => call.init.method === "PUT"
                ? json({etag: "e2"}) : new Response("x", {status: 200, headers: {ETag: "\"e1\""}}))
            await handler.download("projects/p1/project.od")
            await handler.upload("projects/p1/project.od", new ArrayBuffer(2))
            expect(header(calls[1], "X-Echo-If-Match")).toBeUndefined()
        })

        it("forgets a version when the person decided to replace the cloud copy", async () => {
            const {handler, calls} = create(call => call.init.method === "PUT"
                ? json({etag: "e2"}) : new Response("{}", {status: 200, headers: {ETag: "\"e1\""}}))
            await handler.download("projects/index.json")
            handler.forgetVersion("projects/index.json")
            await handler.upload("projects/index.json", new ArrayBuffer(2))
            expect(header(calls[1], "X-Echo-If-Match")).toBeUndefined()
        })

        it("forgets a version for a file that was deleted", async () => {
            const {handler, calls} = create(call => call.init.method === "GET"
                ? new Response("{}", {status: 200, headers: {ETag: "\"e1\""}}) : json({etag: "e3", ok: true}))
            await handler.download("projects/index.json")
            await handler.delete("projects/index.json")
            await handler.upload("projects/index.json", new ArrayBuffer(2))
            expect(header(calls[2], "X-Echo-If-Match")).toBeUndefined()
        })
    })

    describe("big files", () => {
        const respond = (call: Call): Response => {
            if (call.url.includes("/mpu/create")) {return json({uploadId: "u1"})}
            if (call.url.includes("/mpu/part")) {return json({partNumber: Number(new URL(call.url).searchParams.get("part")), etag: "p"})}
            if (call.url.includes("/mpu/complete")) {return json({etag: "done"})}
            return json({ok: true})
        }

        it("goes up in parts of equal size, the last one smaller", async () => {
            const {handler, calls} = create(respond, {singleLimit: 100, partSize: 40})
            const progress: Array<number> = []
            await handler.upload("samples/big.wav", new ArrayBuffer(110), value => progress.push(value))
            const urls = calls.map(call => new URL(call.url).pathname)
            expect(urls).toEqual(["/mpu/create", "/mpu/part", "/mpu/part", "/mpu/part", "/mpu/complete"])
            expect(calls.slice(1, 4).map(call => (call.init.body as ArrayBuffer).byteLength)).toEqual([40, 40, 30])
            expect(calls.slice(1, 4).map(call => new URL(call.url).searchParams.get("part"))).toEqual(["1", "2", "3"])
            expect(JSON.parse(calls[4].init.body as string).parts.map((part: { partNumber: number }) => part.partNumber)).toEqual([1, 2, 3])
            expect(progress).toEqual([1 / 3, 2 / 3, 1])
        })

        it("sends a file at the limit in one piece", async () => {
            const {handler, calls} = create(respond, {singleLimit: 100, partSize: 40})
            await handler.upload("samples/edge.wav", new ArrayBuffer(100))
            expect(calls).toHaveLength(1)
            expect(calls[0].init.method).toBe("PUT")
        })

        it("drops the started upload when a part fails, and says why", async () => {
            const {handler, calls} = create(call => call.url.includes("/mpu/part") && call.url.includes("part=2")
                ? new Response("no space", {status: 500}) : respond(call))
            const failing = create(call => call.url.includes("part=2") ? new Response("no space", {status: 500}) : respond(call),
                {singleLimit: 10, partSize: 5})
            await expect(failing.handler.upload("samples/big.wav", new ArrayBuffer(20))).rejects.toThrow("part 2")
            const last = failing.calls[failing.calls.length - 1]
            expect(new URL(last.url).pathname).toBe("/mpu/abort")
            expect(handler).toBeDefined()
            expect(calls).toHaveLength(0)
        })
    })
})
