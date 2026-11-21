// Helpers for the tests only: an in-memory stand-in for an R2 bucket, and a stand-in for Google's login tokens.
import {Env, R2Bucket, R2ListResult, R2MultipartUpload, R2Object, R2ObjectBody, R2UploadedPart} from "./types"
import {b64urlEncode, Jwk} from "./jwt"

type Stored = { data: Uint8Array, etag: string, uploaded: Date }

const readAll = async (value: ArrayBuffer | ReadableStream<Uint8Array>): Promise<Uint8Array> => {
    if (value instanceof ArrayBuffer) {return new Uint8Array(value.slice(0))}
    return new Uint8Array(await new Response(value).arrayBuffer())
}

export class FakeBucket implements R2Bucket {
    readonly objects = new Map<string, Stored>()
    readonly #uploads = new Map<string, { key: string, parts: Map<number, Uint8Array> }>()
    #counter = 0

    #describe(key: string, stored: Stored): R2Object {
        return {key, size: stored.data.length, etag: stored.etag, httpEtag: `"${stored.etag}"`, uploaded: stored.uploaded}
    }

    async head(key: string): Promise<R2Object | null> {
        const stored = this.objects.get(key)
        return stored === undefined ? null : this.#describe(key, stored)
    }

    async get(key: string): Promise<R2ObjectBody | null> {
        const stored = this.objects.get(key)
        if (stored === undefined) {return null}
        const body = new Response(stored.data.slice()).body as ReadableStream<Uint8Array>
        return {...this.#describe(key, stored), body}
    }

    async put(key: string, value: ArrayBuffer | ReadableStream<Uint8Array>,
              options?: { onlyIf?: { etagMatches?: string } }): Promise<R2Object | null> {
        const wanted = options?.onlyIf?.etagMatches
        if (wanted !== undefined) {
            const current = this.objects.get(key)
            if (current === undefined || current.etag !== wanted) {return null}
        }
        const stored: Stored = {data: await readAll(value), etag: `e${++this.#counter}`, uploaded: new Date()}
        this.objects.set(key, stored)
        return this.#describe(key, stored)
    }

    async delete(keys: string | ReadonlyArray<string>): Promise<void> {
        for (const key of typeof keys === "string" ? [keys] : keys) {this.objects.delete(key)}
    }

    async list(options: { prefix?: string, delimiter?: string, cursor?: string, limit?: number } = {}): Promise<R2ListResult> {
        const prefix = options.prefix ?? ""
        const limit = options.limit ?? 1000
        const keys = [...this.objects.keys()].filter(key => key.startsWith(prefix)).sort()
        const objects: Array<R2Object> = []
        const folders = new Set<string>()
        for (const key of keys) {
            const rest = key.slice(prefix.length)
            const slash = options.delimiter === undefined ? -1 : rest.indexOf(options.delimiter)
            if (slash >= 0) {
                folders.add(prefix + rest.slice(0, slash + 1))
            } else {
                objects.push(this.#describe(key, this.objects.get(key) as Stored))
            }
        }
        const start = options.cursor === undefined ? 0 : Number(options.cursor)
        const page = objects.slice(start, start + limit)
        const truncated = start + limit < objects.length
        return {
            objects: page, truncated, cursor: truncated ? String(start + limit) : undefined,
            delimitedPrefixes: start === 0 ? [...folders] : []
        }
    }

    async createMultipartUpload(key: string): Promise<R2MultipartUpload> {
        const uploadId = `upload-${++this.#counter}`
        this.#uploads.set(uploadId, {key, parts: new Map()})
        return this.resumeMultipartUpload(key, uploadId)
    }

    resumeMultipartUpload(key: string, uploadId: string): R2MultipartUpload {
        const bucket = this
        return {
            key, uploadId,
            async uploadPart(partNumber: number, value: ArrayBuffer | ReadableStream<Uint8Array>): Promise<R2UploadedPart> {
                const upload = bucket.#uploads.get(uploadId)
                if (upload === undefined) {throw new Error("no such upload")}
                upload.parts.set(partNumber, await readAll(value))
                return {partNumber, etag: `part-${uploadId}-${partNumber}`}
            },
            async abort(): Promise<void> {bucket.#uploads.delete(uploadId)},
            async complete(parts: ReadonlyArray<R2UploadedPart>): Promise<R2Object> {
                const upload = bucket.#uploads.get(uploadId)
                if (upload === undefined) {throw new Error("no such upload")}
                const chunks = [...parts].sort((a, b) => a.partNumber - b.partNumber).map(part => {
                    const data = upload.parts.get(part.partNumber)
                    if (data === undefined) {throw new Error("missing part")}
                    return data
                })
                const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
                const data = new Uint8Array(total)
                let offset = 0
                chunks.forEach(chunk => {
                    data.set(chunk, offset)
                    offset += chunk.length
                })
                const stored: Stored = {data, etag: `e${++bucket.#counter}`, uploaded: new Date()}
                bucket.objects.set(key, stored)
                bucket.#uploads.delete(uploadId)
                return bucket.#describe(key, stored)
            }
        }
    }
}

export const ClientId = "test-client.apps.googleusercontent.com"

export type GoogleSigner = {
    jwks: string
    sign(claims: Record<string, unknown>, options?: { kid?: string, alg?: string }): Promise<string>
}

export const createGoogleSigner = async (kid: string = "key-1"): Promise<GoogleSigner> => {
    const pair = await crypto.subtle.generateKey({
        name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256"
    }, true, ["sign", "verify"])
    const exported = await crypto.subtle.exportKey("jwk", pair.publicKey) as { n: string, e: string }
    const jwk: Jwk = {kid, kty: "RSA", n: exported.n, e: exported.e, alg: "RS256", use: "sig"}
    const text = (value: unknown) => b64urlEncode(new TextEncoder().encode(JSON.stringify(value)))
    return {
        jwks: JSON.stringify({keys: [jwk]}),
        sign: async (claims, options = {}) => {
            const data = `${text({alg: options.alg ?? "RS256", typ: "JWT", kid: options.kid ?? kid})}.${text(claims)}`
            const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey, new TextEncoder().encode(data))
            return `${data}.${b64urlEncode(new Uint8Array(signature))}`
        }
    }
}

export const goodClaims = (nowSeconds: number, overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    iss: "https://accounts.google.com", aud: ClientId, exp: nowSeconds + 3600, iat: nowSeconds,
    nonce: "n-123", email: "Me@Example.com", email_verified: true, sub: "1234567890", ...overrides
})

export const makeEnv = (signer: GoogleSigner, bucket: FakeBucket = new FakeBucket(), overrides: Partial<Env> = {}): Env => ({
    BUCKET: bucket,
    GOOGLE_CLIENT_ID: ClientId,
    ALLOWED_EMAILS: "me@example.com, other@example.com",
    ALLOWED_ORIGINS: "https://echo-says-echo.pages.dev",
    SESSION_SECRET: "test-secret-with-enough-length-0123456789",
    JWKS_OVERRIDE: signer.jwks,
    ...overrides
})
