// Runs the real server code on Cloudflare's local Workers runtime (wrangler dev), with a local R2 bucket.
// Only when ECHO_INTEGRATION=1 and WRANGLER_BIN points at a wrangler install, so the normal test run stays quick:
//   ECHO_INTEGRATION=1 WRANGLER_BIN=/path/to/wrangler npx vitest run integration
import {afterAll, beforeAll, describe, expect, it} from "vitest"
import {ChildProcess, spawn} from "node:child_process"
import {mkdtempSync, rmSync, writeFileSync} from "node:fs"
import {tmpdir} from "node:os"
import {join, resolve} from "node:path"
import {createGoogleSigner, ClientId, goodClaims} from "../src/testkit"

const enabled = process.env.ECHO_INTEGRATION === "1" && process.env.WRANGLER_BIN !== undefined
const Port = 8799
const Base = `http://127.0.0.1:${Port}`
const Origin = "https://echo-says-echo.pages.dev"

describe.skipIf(!enabled)("on the local Workers runtime", () => {
    const root = resolve(__dirname, "..")
    const devVars = join(root, ".dev.vars")
    const state = mkdtempSync(join(tmpdir(), "echo-state-"))
    let server: ChildProcess
    let token = ""
    const logs: Array<string> = []

    const api = (path: string, init: RequestInit = {}) => fetch(`${Base}${path}`, {
        ...init, headers: {Authorization: `Bearer ${token}`, ...(init.headers as Record<string, string> ?? {})}
    })

    beforeAll(async () => {
        const signer = await createGoogleSigner()
        writeFileSync(devVars, [
            `GOOGLE_CLIENT_ID=${ClientId}`, "ALLOWED_EMAILS=me@example.com", `ALLOWED_ORIGINS=${Origin}`,
            "SESSION_SECRET=integration-secret-0123456789abcdef", `JWKS_OVERRIDE=${signer.jwks}`
        ].join("\n"))
        server = spawn(process.env.WRANGLER_BIN as string,
            ["dev", "--local", "--ip", "127.0.0.1", "--port", String(Port), "--persist-to", state],
            {cwd: root, env: {...process.env, CI: "true", WRANGLER_SEND_METRICS: "false"}})
        server.stdout?.on("data", chunk => logs.push(String(chunk)))
        server.stderr?.on("data", chunk => logs.push(String(chunk)))
        const deadline = Date.now() + 120_000
        while (Date.now() < deadline) {
            const ready = await fetch(`${Base}/`).then(response => response.ok, () => false)
            if (ready) {break}
            await new Promise(resolve => setTimeout(resolve, 500))
        }
        const idToken = await signer.sign(goodClaims(Math.floor(Date.now() / 1000)))
        const login = await fetch(`${Base}/auth/google`, {method: "POST", body: JSON.stringify({idToken, nonce: "n-123"})})
        expect(login.status, logs.join("")).toBe(200)
        token = ((await login.json()) as { token: string }).token
    }, 150_000)

    afterAll(() => {
        server?.kill("SIGTERM")
        rmSync(devVars, {force: true})
        rmSync(state, {recursive: true, force: true})
    })

    it("stores, reads, lists, checks and deletes files in R2", async () => {
        const put = await api("/files/projects/p1/project.od", {method: "PUT", body: new Uint8Array([1, 2, 3, 4, 5])})
        expect(put.status).toBe(200)
        const read = await api("/files/projects/p1/project.od")
        expect(Array.from(new Uint8Array(await read.arrayBuffer()))).toEqual([1, 2, 3, 4, 5])
        await api("/files/projects/p1/meta.json", {method: "PUT", body: "{}"})
        const listed = await (await api("/list?path=projects/p1")).json() as { names: Array<string> }
        expect(listed.names.sort()).toEqual(["meta.json", "project.od"])
        const folders = await (await api("/list?path=projects")).json() as { names: Array<string> }
        expect(folders.names).toEqual(["p1"])
        expect((await api("/files/projects/p1", {method: "HEAD"})).status).toBe(200)
        expect((await api("/files/projects/p9", {method: "HEAD"})).status).toBe(404)
        expect((await api("/files/projects/p1", {method: "DELETE"})).status).toBe(200)
        expect((await api("/files/projects/p1/project.od")).status).toBe(404)
    }, 30_000)

    it("refuses to overwrite a file somebody else changed (real R2 etags)", async () => {
        const first = await (await api("/files/projects/index.json", {method: "PUT", body: "v1"})).json() as { etag: string }
        const read = await api("/files/projects/index.json")
        expect(read.headers.get("ETag")).toBe(`"${first.etag}"`)
        const second = await api("/files/projects/index.json", {method: "PUT", body: "v2", headers: {"X-Echo-If-Match": first.etag}})
        expect(second.status).toBe(200)
        const stale = await api("/files/projects/index.json", {method: "PUT", body: "v3", headers: {"X-Echo-If-Match": first.etag}})
        expect(stale.status).toBe(412)
        expect(await (await api("/files/projects/index.json")).text()).toBe("v2")
    }, 30_000)

    it("streams a 20 MB file in and out unchanged", async () => {
        const data = new Uint8Array(20 * 1024 * 1024)
        for (let i = 0; i < data.length; i += 4099) {data[i] = (i / 4099) % 251}
        expect((await api("/files/samples/one.wav", {method: "PUT", body: data})).status).toBe(200)
        const back = new Uint8Array(await (await api("/files/samples/one.wav")).arrayBuffer())
        expect(back.length).toBe(data.length)
        expect(Buffer.compare(Buffer.from(back), Buffer.from(data))).toBe(0)
    }, 60_000)

    it("assembles a file from parts of equal size", async () => {
        const partSize = 5 * 1024 * 1024
        const sizes = [partSize, partSize, 1234]
        const whole = new Uint8Array(sizes.reduce((sum, size) => sum + size, 0))
        for (let i = 0; i < whole.length; i += 997) {whole[i] = (i / 997) % 253}
        const {uploadId} = await (await api("/mpu/create?path=samples/parts.wav", {method: "POST"})).json() as { uploadId: string }
        const parts = []
        let offset = 0
        for (const [index, size] of sizes.entries()) {
            const response = await api(`/mpu/part?path=samples/parts.wav&uploadId=${uploadId}&part=${index + 1}`,
                {method: "PUT", body: whole.slice(offset, offset + size)})
            expect(response.status, logs.join("")).toBe(200)
            parts.push(await response.json())
            offset += size
        }
        const done = await api(`/mpu/complete?path=samples/parts.wav&uploadId=${uploadId}`,
            {method: "POST", body: JSON.stringify({parts})})
        expect(done.status, logs.join("")).toBe(200)
        const back = new Uint8Array(await (await api("/files/samples/parts.wav")).arrayBuffer())
        expect(Buffer.compare(Buffer.from(back), Buffer.from(whole))).toBe(0)
    }, 60_000)

    it("answers the browser's preflight and exposes the etag", async () => {
        const preflight = await fetch(`${Base}/files/x`, {method: "OPTIONS", headers: {Origin}})
        expect(preflight.status).toBe(204)
        expect(preflight.headers.get("access-control-allow-origin")).toBe(Origin)
        const read = await api("/auth/me", {headers: {Origin}})
        expect(read.headers.get("access-control-expose-headers")).toContain("ETag")
    })
})
