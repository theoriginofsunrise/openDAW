import {beforeEach, describe, expect, it} from "vitest"
import worker from "./index"
import {allowedEmails, authenticate, issueSession, userIdFor, verifyGoogleIdToken} from "./auth"
import {signSession, verifySession} from "./jwt"
import {cleanPath, MaxSingleUpload} from "./files"
import {Env} from "./types"
import {cleanShared, SharedPrefix} from "./cleanup"
import {countUsage, forgetUsage, FreeBytes, kindOf, usageOf} from "./usage"
import {ClientId, createGoogleSigner, FakeBucket, GoogleSigner, goodClaims, makeEnv} from "./testkit"

const Origin = "https://echo-says-echo.pages.dev"
const now = Math.floor(Date.now() / 1000)

describe("session tokens", () => {
    const secret = "a-secret-long-enough-for-the-test"

    it("verifies what it signed", async () => {
        const token = await signSession(secret, {sub: "a@b.c", iat: now, exp: now + 60})
        expect(await verifySession(secret, token, now)).toEqual({sub: "a@b.c", iat: now, exp: now + 60})
    })

    it("refuses a token signed with another secret", async () => {
        const token = await signSession("another-secret", {sub: "a@b.c", iat: now, exp: now + 60})
        expect(await verifySession(secret, token, now)).toBeNull()
    })

    it("refuses an expired token", async () => {
        const token = await signSession(secret, {sub: "a@b.c", iat: now - 120, exp: now - 60})
        expect(await verifySession(secret, token, now)).toBeNull()
    })

    it("refuses a token whose content was changed", async () => {
        const token = await signSession(secret, {sub: "a@b.c", iat: now, exp: now + 60})
        const [header, , signature] = token.split(".")
        const forged = btoa(JSON.stringify({sub: "evil@b.c", iat: now, exp: now + 60})).replace(/=+$/, "")
        expect(await verifySession(secret, `${header}.${forged}.${signature}`, now)).toBeNull()
    })

    it("refuses a token that claims no signature", async () => {
        const text = (value: unknown) => btoa(JSON.stringify(value)).replace(/=+$/, "")
        const none = `${text({alg: "none", typ: "JWT"})}.${text({sub: "a@b.c", iat: now, exp: now + 60})}.`
        expect(await verifySession(secret, none, now)).toBeNull()
    })

    it("refuses garbage", async () => {
        expect(await verifySession(secret, "nonsense", now)).toBeNull()
        expect(await verifySession(secret, "a.b.c", now)).toBeNull()
    })
})

describe("Google login", () => {
    let signer: GoogleSigner
    let env: Env
    beforeEach(async () => {
        signer = await createGoogleSigner()
        env = makeEnv(signer)
    })
    const check = async (claims: Record<string, unknown>, nonce: string = "n-123", options?: { kid?: string, alg?: string }) =>
        verifyGoogleIdToken(env, await signer.sign(claims, options), nonce, now * 1000)

    it("accepts a good login and lowercases the email", async () => {
        expect(await check(goodClaims(now))).toEqual({ok: true, email: "me@example.com"})
    })

    it("accepts the other issuer spelling", async () => {
        expect((await check(goodClaims(now, {iss: "accounts.google.com"}))).ok).toBe(true)
    })

    it("refuses a login meant for another app", async () => {
        const result = await check(goodClaims(now, {aud: "someone-else"}))
        expect(result).toMatchObject({ok: false, status: 401})
    })

    it("refuses a login from another issuer", async () => {
        expect((await check(goodClaims(now, {iss: "https://evil.example"}))).ok).toBe(false)
    })

    it("refuses an expired login", async () => {
        expect(await check(goodClaims(now, {exp: now - 600}))).toMatchObject({ok: false, error: "expired"})
    })

    it("refuses a login for another attempt (nonce)", async () => {
        expect((await check(goodClaims(now), "something-else")).ok).toBe(false)
        expect((await check(goodClaims(now, {nonce: undefined}), "")).ok).toBe(false)
    })

    it("refuses an email Google has not verified", async () => {
        expect((await check(goodClaims(now, {email_verified: false}))).ok).toBe(false)
    })

    it("refuses an email that is not on the list, with a clear 403", async () => {
        expect(await check(goodClaims(now, {email: "stranger@example.com"})))
            .toMatchObject({ok: false, status: 403, error: "not_allowed"})
    })

    it("refuses a token signed with a key Google does not have", async () => {
        const other = await createGoogleSigner("key-1")
        const forged = await other.sign(goodClaims(now))
        expect((await verifyGoogleIdToken(env, forged, "n-123", now * 1000)).ok).toBe(false)
    })

    it("refuses an unknown key id and an unsupported algorithm", async () => {
        expect((await check(goodClaims(now), "n-123", {kid: "other"})).ok).toBe(false)
        expect((await check(goodClaims(now), "n-123", {alg: "HS256"})).ok).toBe(false)
    })

    it("says so when the server is not set up", async () => {
        const empty = makeEnv(signer, new FakeBucket(), {ALLOWED_EMAILS: ""})
        const result = await verifyGoogleIdToken(empty, await signer.sign(goodClaims(now)), "n-123", now * 1000)
        expect(result).toMatchObject({ok: false, status: 500, error: "server_not_configured"})
        const noClient = makeEnv(signer, new FakeBucket(), {GOOGLE_CLIENT_ID: ""})
        expect((await verifyGoogleIdToken(noClient, await signer.sign(goodClaims(now)), "n-123", now * 1000)).ok).toBe(false)
    })

    it("reads the allow list without caring about case and spaces", () => {
        expect(allowedEmails(makeEnv(signer, new FakeBucket(), {ALLOWED_EMAILS: " A@B.C ,d@e.f,, "}))).toEqual(["a@b.c", "d@e.f"])
    })

    it("gives every person a stable private folder name", async () => {
        expect(await userIdFor("Me@Example.com")).toBe(await userIdFor("me@example.com"))
        expect(await userIdFor("me@example.com")).not.toBe(await userIdFor("other@example.com"))
        expect(await userIdFor("me@example.com")).toMatch(/^[0-9a-f]{32}$/)
    })

    it("ends the access of a person removed from the list, even with a valid session", async () => {
        const {token} = await issueSession(env, "other@example.com", now)
        const request = new Request("https://x/auth/me", {headers: {Authorization: `Bearer ${token}`}})
        expect(await authenticate(env, request, now)).not.toBeNull()
        const reduced = makeEnv(signer, new FakeBucket(), {ALLOWED_EMAILS: "me@example.com"})
        expect(await authenticate(reduced, request, now)).toBeNull()
    })
})

describe("paths", () => {
    it("accepts ordinary paths", () => {
        expect(cleanPath("projects/abc/project.od")).toBe("projects/abc/project.od")
        expect(cleanPath("/projects/index.json")).toBe("projects/index.json")
        expect(cleanPath("samples/uuid.wav")).toBe("samples/uuid.wav")
        expect(cleanPath("my folder/a (1).json")).toBe("my folder/a (1).json")
    })

    it("refuses ways out of a person's folder and odd input", () => {
        expect(cleanPath("../other/file")).toBeNull()
        expect(cleanPath("a/../../b")).toBeNull()
        expect(cleanPath("a/./b")).toBeNull()
        expect(cleanPath("a//b")).toBeNull()
        expect(cleanPath("a\\b")).toBeNull()
        expect(cleanPath("a/\u0000b")).toBeNull()
        expect(cleanPath("")).toBeNull()
        expect(cleanPath("x".repeat(701))).toBeNull()
        expect(cleanPath("x".repeat(201))).toBeNull()
    })

    it("allows the root only where it is asked for", () => {
        expect(cleanPath("", true)).toBe("")
        expect(cleanPath("/", true)).toBe("")
    })
})

describe("the server", () => {
    let signer: GoogleSigner
    let bucket: FakeBucket
    let env: Env
    let token: string
    beforeEach(async () => {
        signer = await createGoogleSigner()
        bucket = new FakeBucket()
        env = makeEnv(signer, bucket)
        token = (await issueSession(env, "me@example.com", now)).token
    })

    const call = (path: string, init: RequestInit = {}, as: string | null = token) =>
        worker.fetch(new Request(`https://server.example${path}`, {
            ...init,
            headers: {...(as === null ? {} : {Authorization: `Bearer ${as}`}), ...(init.headers as Record<string, string> ?? {})}
        }), env)
    // a real request carries its length (the runtime adds it); a request made in a test does not
    const lengthOf = (body: string | Uint8Array) => String(typeof body === "string" ? new TextEncoder().encode(body).length : body.length)
    const put = (path: string, body: string | Uint8Array, headers: Record<string, string> = {}, as: string | null = token) =>
        call(`/files/${path}`, {method: "PUT", body: body as BodyInit, headers: {"Content-Length": lengthOf(body), ...headers}}, as)
    const text = async (response: Response) => new TextDecoder().decode(await response.arrayBuffer())

    it("answers a health check without a login", async () => {
        const response = await call("/", {}, null)
        expect(response.status).toBe(200)
        expect(await response.json()).toMatchObject({ok: true})
    })

    it("signs a person in with a Google token and then knows them", async () => {
        const idToken = await signer.sign(goodClaims(Math.floor(Date.now() / 1000)))
        const login = await call("/auth/google", {method: "POST", body: JSON.stringify({idToken, nonce: "n-123"})}, null)
        expect(login.status).toBe(200)
        const {token: session, email} = await login.json() as { token: string, email: string }
        expect(email).toBe("me@example.com")
        const me = await call("/auth/me", {}, session)
        expect(await me.json()).toMatchObject({email: "me@example.com"})
    })

    it("refuses a stranger, with a message that says why", async () => {
        const idToken = await signer.sign(goodClaims(Math.floor(Date.now() / 1000), {email: "stranger@example.com"}))
        const login = await call("/auth/google", {method: "POST", body: JSON.stringify({idToken, nonce: "n-123"})}, null)
        expect(login.status).toBe(403)
        expect(await login.json()).toMatchObject({error: "not_allowed"})
    })

    it("refuses a login request without the right fields, and when no session secret exists", async () => {
        expect((await call("/auth/google", {method: "POST", body: "{}"}, null)).status).toBe(400)
        env = makeEnv(signer, bucket, {SESSION_SECRET: undefined})
        const idToken = await signer.sign(goodClaims(Math.floor(Date.now() / 1000)))
        const login = await call("/auth/google", {method: "POST", body: JSON.stringify({idToken, nonce: "n-123"})}, null)
        expect(login.status).toBe(500)
    })

    it("needs a login for everything else", async () => {
        expect((await call("/auth/me", {}, null)).status).toBe(401)
        expect((await call("/files/a.txt", {}, null)).status).toBe(401)
        expect((await call("/list?path=", {}, null)).status).toBe(401)
        expect((await call("/files/a.txt", {}, "garbage")).status).toBe(401)
    })

    it("stores a file, reads it back and tells its etag", async () => {
        const stored = await put("projects/p1/meta.json", "hello")
        expect(stored.status).toBe(200)
        const {etag} = await stored.json() as { etag: string }
        const read = await call("/files/projects/p1/meta.json")
        expect(read.status).toBe(200)
        expect(await text(read)).toBe("hello")
        expect(read.headers.get("ETag")).toBe(`"${etag}"`)
    })

    it("answers 404 for a file that is not there", async () => {
        expect((await call("/files/nope.txt")).status).toBe(404)
    })

    it("tells whether a file or a folder exists", async () => {
        await put("projects/p1/meta.json", "x")
        expect((await call("/files/projects/p1/meta.json", {method: "HEAD"})).status).toBe(200)
        expect((await call("/files/projects/p1", {method: "HEAD"})).status).toBe(200)
        expect((await call("/files/projects/p2", {method: "HEAD"})).status).toBe(404)
        expect((await call("/files/projects/p1/other.json", {method: "HEAD"})).status).toBe(404)
    })

    it("lists the files and folders directly inside a folder", async () => {
        await put("projects/p1/project.od", "a")
        await put("projects/p1/meta.json", "b")
        await put("projects/p2/meta.json", "c")
        await put("projects/index.json", "d")
        const inProject = await (await call("/list?path=projects/p1")).json() as { names: Array<string> }
        expect(inProject.names.sort()).toEqual(["meta.json", "project.od"])
        const inProjects = await (await call("/list?path=projects")).json() as { names: Array<string> }
        expect(inProjects.names.sort()).toEqual(["index.json", "p1", "p2"])
        const root = await (await call("/list?path=")).json() as { names: Array<string> }
        expect(root.names).toEqual(["projects"])
        const missing = await (await call("/list?path=nothing")).json() as { names: Array<string> }
        expect(missing.names).toEqual([])
    })

    it("deletes a file, and a folder with everything inside, and does not mind deleting what is gone", async () => {
        await put("projects/p1/project.od", "a")
        await put("projects/p1/meta.json", "b")
        await put("projects/p10/meta.json", "keep")
        expect((await call("/files/projects/p1", {method: "DELETE"})).status).toBe(200)
        expect((await call("/files/projects/p1/meta.json")).status).toBe(404)
        expect((await call("/files/projects/p10/meta.json")).status).toBe(200)
        expect((await call("/files/projects/p10/meta.json", {method: "DELETE"})).status).toBe(200)
        expect((await call("/files/projects/p10/meta.json", {method: "DELETE"})).status).toBe(200)
    })

    it("keeps every person's files apart", async () => {
        await put("secret.txt", "mine")
        const other = (await issueSession(env, "other@example.com", now)).token
        expect((await call("/files/secret.txt", {}, other)).status).toBe(404)
        expect((await (await call("/list?path=", {}, other)).json() as { names: Array<string> }).names).toEqual([])
        await put("secret.txt", "theirs", {}, other)
        expect(await text(await call("/files/secret.txt"))).toBe("mine")
        await call("/files/secret.txt", {method: "DELETE"}, other)
        expect(await text(await call("/files/secret.txt"))).toBe("mine")
    })

    it("cannot be talked into another person's folder", async () => {
        // a plain ".." never reaches the server: the URL is cleaned up on the way (to another place in the same folder)
        expect((await call("/files/../x")).status).toBe(404)
        // an encoded slash does reach it, and is refused
        expect((await call("/files/a%2F..%2Fb")).status).toBe(400)
        expect((await call("/files/a%5Cb")).status).toBe(400)
        expect((await call("/list?path=../other")).status).toBe(400)
    })

    it("only overwrites a file when the client has seen its latest version", async () => {
        const first = await (await put("projects/index.json", "v1")).json() as { etag: string }
        const second = await put("projects/index.json", "v2", {"X-Echo-If-Match": first.etag})
        expect(second.status).toBe(200)
        const stale = await put("projects/index.json", "v3", {"X-Echo-If-Match": first.etag})
        expect(stale.status).toBe(412)
        expect(await text(await call("/files/projects/index.json"))).toBe("v2")
        const free = await put("projects/index.json", "v4")
        expect(free.status).toBe(200)
    })

    it("does not overwrite a file that is gone when a version is demanded", async () => {
        expect((await put("gone.json", "x", {"X-Echo-If-Match": "e999"})).status).toBe(412)
    })

    it("refuses a single upload that is too big for one request, and one with no length", async () => {
        const big = await put("big.wav", "x", {"Content-Length": String(MaxSingleUpload + 1)})
        expect(big.status).toBe(413)
        expect(await big.json()).toMatchObject({error: "too_large", maxBytes: MaxSingleUpload})
        const unknown = await call("/files/nolength.wav", {method: "PUT", body: "x"})
        expect(unknown.status).toBe(411)
    })

    it("stores a big file in parts", async () => {
        const created = await call("/mpu/create?path=samples/big.wav", {method: "POST"})
        const {uploadId} = await created.json() as { uploadId: string }
        const parts = []
        for (const [index, chunk] of ["aaaa", "bbbb", "cc"].entries()) {
            const response = await call(`/mpu/part?path=samples/big.wav&uploadId=${uploadId}&part=${index + 1}`,
                {method: "PUT", body: chunk, headers: {"Content-Length": lengthOf(chunk)}})
            expect(response.status).toBe(200)
            parts.push(await response.json())
        }
        const done = await call(`/mpu/complete?path=samples/big.wav&uploadId=${uploadId}`,
            {method: "POST", body: JSON.stringify({parts})})
        expect(done.status).toBe(200)
        expect(await text(await call("/files/samples/big.wav"))).toBe("aaaabbbbcc")
    })

    it("can drop a started multipart upload, and refuses odd part requests", async () => {
        const {uploadId} = await (await call("/mpu/create?path=a.wav", {method: "POST"})).json() as { uploadId: string }
        const one = {"Content-Length": "1"}
        expect((await call(`/mpu/part?path=a.wav&uploadId=${uploadId}&part=0`, {method: "PUT", body: "x", headers: one})).status).toBe(400)
        expect((await call(`/mpu/part?path=a.wav&part=1`, {method: "PUT", body: "x", headers: one})).status).toBe(400)
        expect((await call(`/mpu/complete?path=a.wav&uploadId=${uploadId}`, {method: "POST", body: "{}"})).status).toBe(400)
        expect((await call(`/mpu/abort?path=a.wav&uploadId=${uploadId}`, {method: "POST"})).status).toBe(200)
    })

    it("lets the app's website call it from the browser, and nobody else's", async () => {
        const allowed = await call("/auth/me", {headers: {Origin}})
        expect(allowed.headers.get("Access-Control-Allow-Origin")).toBe(Origin)
        expect(allowed.headers.get("Access-Control-Expose-Headers")).toContain("ETag")
        expect(allowed.headers.get("Cross-Origin-Resource-Policy")).toBe("cross-origin")
        const stranger = await call("/auth/me", {headers: {Origin: "https://evil.example"}})
        expect(stranger.headers.get("Access-Control-Allow-Origin")).toBeNull()
        const preflight = await call("/files/x", {method: "OPTIONS", headers: {Origin}}, null)
        expect(preflight.status).toBe(204)
        expect(preflight.headers.get("Access-Control-Allow-Headers")).toContain("Authorization")
        expect(preflight.headers.get("Access-Control-Allow-Methods")).toContain("PUT")
    })

    it("answers 404 for unknown places", async () => {
        expect((await call("/nothing")).status).toBe(404)
        expect((await call("/files/x", {method: "PATCH"})).status).toBe(405)
    })

    it("knows its own client id", () => {
        expect(ClientId).toContain("googleusercontent")
    })

    describe("the shared folder of the live rooms", () => {
        it("lets everybody who may sign in read what another one put there", async () => {
            const other = (await issueSession(env, "other@example.com", now)).token
            const stored = await call("/shared/rooms/abc/samples/u1/audio.wav", {
                method: "PUT", body: "wave", headers: {"Content-Length": "4"}
            })
            expect(stored.status).toBe(200)
            const read = await call("/shared/rooms/abc/samples/u1/audio.wav", {}, other)
            expect(read.status).toBe(200)
            expect(await text(read)).toBe("wave")
            expect((await call("/shared/rooms/abc/samples/u1/audio.wav", {method: "HEAD"}, other)).status).toBe(200)
            expect((await call("/shared/rooms/abc/samples/u2/audio.wav", {method: "HEAD"}, other)).status).toBe(404)
        })

        it("needs a login, and does not let anything be deleted or listed", async () => {
            expect((await call("/shared/rooms/abc/x", {}, null)).status).toBe(401)
            expect((await call("/shared/rooms/abc/x", {method: "PUT", body: "x", headers: {"Content-Length": "1"}}, null)).status).toBe(401)
            await call("/shared/rooms/abc/x", {method: "PUT", body: "x", headers: {"Content-Length": "1"}})
            expect((await call("/shared/rooms/abc/x", {method: "DELETE"})).status).toBe(405)
            expect((await call("/shared/rooms/abc/x")).status).toBe(200)
        })

        it("does not reach anybody's own files, and keeps its own apart from them", async () => {
            await put("secret.txt", "mine")
            expect((await call("/shared/secret.txt")).status).toBe(404)
            await call("/shared/open.txt", {method: "PUT", body: "all", headers: {"Content-Length": "3"}})
            expect((await call("/files/open.txt")).status).toBe(404)
            expect((await call("/shared/a%2F..%2Fb")).status).toBe(400)
        })

        it("is cleaned out after a day, and only it", async () => {
            const day = 24 * 60 * 60 * 1000
            await call("/shared/rooms/old/audio.wav", {method: "PUT", body: "old", headers: {"Content-Length": "3"}})
            await call("/shared/rooms/new/audio.wav", {method: "PUT", body: "new", headers: {"Content-Length": "3"}})
            await put("projects/index.json", "{}")
            const oldKey = `${SharedPrefix}rooms/old/audio.wav`
            const stored = bucket.objects.get(oldKey) as { uploaded: Date }
            stored.uploaded = new Date(Date.now() - 2 * day)
            expect(await cleanShared(bucket, Date.now())).toBe(1)
            expect(bucket.objects.has(oldKey)).toBe(false)
            expect(bucket.objects.has(`${SharedPrefix}rooms/new/audio.wav`)).toBe(true)
            expect([...bucket.objects.keys()].some(key => key.endsWith("/projects/index.json"))).toBe(true)
            expect(await cleanShared(bucket, Date.now())).toBe(0)
        })
    })

    describe("what is stored", () => {
        const store = (key: string, size: number) => {
            bucket.objects.set(key, {data: new Uint8Array(size), etag: `e-${key}`, uploaded: new Date()})
        }

        it("tells the kind of a stored file from its place", () => {
            expect(kindOf("u/abc/projects/p1/project.od")).toBe("projects")
            expect(kindOf("u/abc/projects/index.json")).toBe("projects")
            expect(kindOf("u/abc/samples/uuid.wav")).toBe("samples")
            expect(kindOf("u/shared/rooms/jam/samples/x/audio.wav")).toBe("rooms")
            expect(kindOf("u/abc/presence/note.json")).toBe("other")
            expect(kindOf("somewhere/else")).toBe("other")
        })

        it("counts everything, by kind, and what is the signed-in person's own", async () => {
            const me = await userIdFor("me@example.com")
            const other = await userIdFor("other@example.com")
            store(`u/${me}/projects/p1/project.od`, 1000)
            store(`u/${me}/projects/p1/meta.json`, 100)
            store(`u/${me}/samples/a.wav`, 5000)
            store(`u/${other}/samples/b.wav`, 7000)
            store(`u/shared/rooms/jam/samples/c/audio.wav`, 300)
            store(`u/${me}/presence/x.json`, 10)
            const usage = await countUsage(bucket, me, 1234)
            expect(usage.freeBytes).toBe(FreeBytes)
            expect(usage.total).toEqual({bytes: 13410, objects: 6})
            expect(usage.kinds).toEqual({
                projects: {bytes: 1100, objects: 2}, samples: {bytes: 12000, objects: 2},
                rooms: {bytes: 300, objects: 1}, other: {bytes: 10, objects: 1}
            })
            expect(usage.mine).toEqual({bytes: 6110, objects: 4})
            expect(usage.at).toBe(1234)
        })

        it("lists the biggest files of the person and of the rooms, not of other people", async () => {
            const me = await userIdFor("me@example.com")
            const other = await userIdFor("other@example.com")
            store(`u/${me}/samples/small.wav`, 10)
            store(`u/${me}/samples/big.wav`, 900)
            store(`u/${other}/samples/huge.wav`, 99999)
            store(`u/shared/rooms/jam/audio.wav`, 500)
            const {largest} = await countUsage(bucket, me, 0)
            expect(largest.map(entry => entry.path)).toEqual(["samples/big.wav", "shared/rooms/jam/audio.wav", "samples/small.wav"])
            expect(largest.map(entry => entry.bytes)).toEqual([900, 500, 10])
        })

        it("keeps only the ten biggest", async () => {
            const me = await userIdFor("me@example.com")
            for (let i = 0; i < 70; i++) {store(`u/${me}/samples/f${i}.wav`, 100 + i)}
            const {largest, total} = await countUsage(bucket, me, 0)
            expect(total.objects).toBe(70)
            expect(largest).toHaveLength(10)
            expect(largest[0].bytes).toBe(169)
            expect(largest[9].bytes).toBe(160)
        })

        it("counts a bucket that needs more than one listing", async () => {
            const me = await userIdFor("me@example.com")
            for (let i = 0; i < 2300; i++) {store(`u/${me}/samples/f${i}.wav`, 10)}
            const usage = await countUsage(bucket, me, 0)
            expect(usage.total).toEqual({bytes: 23000, objects: 2300})
        })

        it("is an empty count for an empty bucket", async () => {
            const usage = await countUsage(bucket, "nobody", 0)
            expect(usage.total).toEqual({bytes: 0, objects: 0})
            expect(usage.largest).toEqual([])
        })

        it("reuses a count for a minute, unless a new one is asked for", async () => {
            forgetUsage()
            const me = await userIdFor("me@example.com")
            store(`u/${me}/samples/a.wav`, 100)
            const first = await usageOf(bucket, me, 1000)
            store(`u/${me}/samples/b.wav`, 100)
            expect((await usageOf(bucket, me, 30_000)).total.bytes).toBe(first.total.bytes)
            expect((await usageOf(bucket, me, 61_001)).total.bytes).toBe(200)
            store(`u/${me}/samples/c.wav`, 100)
            expect((await usageOf(bucket, me, 61_500)).total.bytes).toBe(200)
            expect((await usageOf(bucket, me, 61_600, true)).total.bytes).toBe(300)
            forgetUsage()
        })

        it("answers the request, for signed-in people only", async () => {
            forgetUsage()
            await put("samples/a.wav", "12345")
            const response = await call("/usage")
            expect(response.status).toBe(200)
            const usage = await response.json() as { total: { bytes: number }, mine: { objects: number }, freeBytes: number }
            expect(usage.total.bytes).toBe(5)
            expect(usage.mine.objects).toBe(1)
            expect(usage.freeBytes).toBe(FreeBytes)
            expect((await call("/usage", {}, null)).status).toBe(401)
            forgetUsage()
        })
    })
})
