// The small part of the Cloudflare Workers / R2 API this server uses, declared here so that no extra package is needed.
export interface R2Object {
    readonly key: string
    readonly size: number
    readonly etag: string
    readonly httpEtag: string
    readonly uploaded: Date
}

export interface R2ObjectBody extends R2Object {
    readonly body: ReadableStream<Uint8Array>
}

export interface R2ListResult {
    readonly objects: ReadonlyArray<R2Object>
    readonly truncated: boolean
    readonly cursor?: string
    readonly delimitedPrefixes: ReadonlyArray<string>
}

export interface R2UploadedPart {
    readonly partNumber: number
    readonly etag: string
}

export interface R2MultipartUpload {
    readonly key: string
    readonly uploadId: string
    uploadPart(partNumber: number, value: ArrayBuffer | ReadableStream<Uint8Array>): Promise<R2UploadedPart>
    abort(): Promise<void>
    complete(parts: ReadonlyArray<R2UploadedPart>): Promise<R2Object>
}

export interface R2Bucket {
    head(key: string): Promise<R2Object | null>
    get(key: string): Promise<R2ObjectBody | null>
    put(key: string, value: ArrayBuffer | ReadableStream<Uint8Array>,
        options?: { onlyIf?: { etagMatches?: string } }): Promise<R2Object | null>
    delete(keys: string | ReadonlyArray<string>): Promise<void>
    list(options?: { prefix?: string, delimiter?: string, cursor?: string, limit?: number }): Promise<R2ListResult>
    createMultipartUpload(key: string): Promise<R2MultipartUpload>
    resumeMultipartUpload(key: string, uploadId: string): R2MultipartUpload
}

export interface Env {
    readonly BUCKET: R2Bucket
    readonly GOOGLE_CLIENT_ID: string
    readonly ALLOWED_EMAILS: string
    readonly ALLOWED_ORIGINS: string
    // signs the session tokens this server hands out; created by the deploy workflow
    readonly SESSION_SECRET?: string
    // tests only: a JSON key set to use instead of Google's, never set in production
    readonly JWKS_OVERRIDE?: string
}
