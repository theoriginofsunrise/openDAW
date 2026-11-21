import {Env, R2UploadedPart} from "./types"

// Cloudflare's free plan accepts at most 100 MB in one request: stay below it, bigger files go in parts.
export const MaxSingleUpload = 95 * 1024 * 1024
const MaxPathLength = 700
const MaxSegmentLength = 200

export const json = (body: unknown, status: number = 200): Response =>
    new Response(JSON.stringify(body), {status, headers: {"Content-Type": "application/json", "Cache-Control": "no-store"}})

// A path inside a person's folder, from the decoded segments of a URL. Null when it is not acceptable.
export const cleanPath = (raw: string, allowEmpty: boolean = false): string | null => {
    if (raw.length > MaxPathLength) {return null}
    const segments = raw.split("/").filter((segment, index, all) =>
        // one leading or trailing slash is fine, empty segments in the middle are not
        segment.length > 0 || index === 0 || index === all.length - 1)
        .filter(segment => segment.length > 0)
    if (segments.length === 0) {return allowEmpty ? "" : null}
    for (const segment of segments) {
        if (segment === "." || segment === ".." || segment.length > MaxSegmentLength
            || /[\u0000-\u001f\\]/.test(segment)) {return null}
    }
    if (raw.replace(/^\/|\/$/g, "").split("/").some(segment => segment.length === 0)) {return null}
    return segments.join("/")
}

const keyFor = (userId: string, path: string): string => `u/${userId}/${path}`
const folderPrefix = (userId: string, path: string): string => path === "" ? `u/${userId}/` : `u/${userId}/${path}/`

export const getFile = async (env: Env, userId: string, path: string): Promise<Response> => {
    const object = await env.BUCKET.get(keyFor(userId, path))
    if (object === null) {return json({error: "not_found"}, 404)}
    return new Response(object.body, {
        headers: {
            "Content-Type": "application/octet-stream",
            "Content-Length": String(object.size),
            "ETag": object.httpEtag,
            "Cache-Control": "no-store"
        }
    })
}

// A file, or a folder (anything stored below the path), exists.
export const headFile = async (env: Env, userId: string, path: string): Promise<Response> => {
    const object = await env.BUCKET.head(keyFor(userId, path))
    if (object !== null) {return new Response(null, {status: 200, headers: {"ETag": object.httpEtag}})}
    const below = await env.BUCKET.list({prefix: folderPrefix(userId, path), limit: 1})
    return new Response(null, {status: below.objects.length > 0 ? 200 : 404})
}

export const putFile = async (env: Env, userId: string, path: string, request: Request): Promise<Response> => {
    const lengthHeader = request.headers.get("Content-Length")
    const length = Number(lengthHeader)
    if (lengthHeader === null || !Number.isFinite(length)) {return json({error: "length_required"}, 411)}
    if (length > MaxSingleUpload) {return json({error: "too_large", maxBytes: MaxSingleUpload}, 413)}
    if (request.body === null) {return json({error: "empty_body"}, 400)}
    const ifMatch = request.headers.get("X-Echo-If-Match")
    const stored = await env.BUCKET.put(keyFor(userId, path), request.body,
        ifMatch === null ? undefined : {onlyIf: {etagMatches: ifMatch}})
    // null: the file is not the one the client last saw, somebody else changed it
    if (stored === null) {return json({error: "precondition_failed"}, 412)}
    return json({etag: stored.etag})
}

// The file, and everything below it when it is a folder. Deleting what is not there is not an error.
export const deleteFile = async (env: Env, userId: string, path: string): Promise<Response> => {
    const key = keyFor(userId, path)
    await env.BUCKET.delete(key)
    let cursor: string | undefined = undefined
    do {
        const page: Awaited<ReturnType<Env["BUCKET"]["list"]>> =
            await env.BUCKET.list({prefix: `${key}/`, cursor, limit: 1000})
        if (page.objects.length > 0) {await env.BUCKET.delete(page.objects.map(object => object.key))}
        cursor = page.truncated ? page.cursor : undefined
    } while (cursor !== undefined)
    return json({ok: true})
}

// Names of what is directly inside a folder: files and sub folders, like a Drive folder listing.
export const listFiles = async (env: Env, userId: string, path: string): Promise<Response> => {
    const prefix = folderPrefix(userId, path)
    const names: Array<string> = []
    let cursor: string | undefined = undefined
    do {
        const page: Awaited<ReturnType<Env["BUCKET"]["list"]>> =
            await env.BUCKET.list({prefix, delimiter: "/", cursor, limit: 1000})
        page.objects.forEach(object => names.push(object.key.slice(prefix.length)))
        page.delimitedPrefixes.forEach(folder => names.push(folder.slice(prefix.length).replace(/\/$/, "")))
        cursor = page.truncated ? page.cursor : undefined
    } while (cursor !== undefined)
    return json({names})
}

export const multipartCreate = async (env: Env, userId: string, path: string): Promise<Response> => {
    const upload = await env.BUCKET.createMultipartUpload(keyFor(userId, path))
    return json({uploadId: upload.uploadId})
}

export const multipartPart = async (env: Env, userId: string, path: string, uploadId: string,
                                    partNumber: number, request: Request): Promise<Response> => {
    if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10000) {return json({error: "bad_part"}, 400)}
    const length = Number(request.headers.get("Content-Length"))
    if (request.headers.get("Content-Length") === null || !Number.isFinite(length)) {return json({error: "length_required"}, 411)}
    if (length > MaxSingleUpload) {return json({error: "too_large", maxBytes: MaxSingleUpload}, 413)}
    if (request.body === null) {return json({error: "empty_body"}, 400)}
    const upload = env.BUCKET.resumeMultipartUpload(keyFor(userId, path), uploadId)
    const part = await upload.uploadPart(partNumber, request.body)
    return json({partNumber: part.partNumber, etag: part.etag})
}

export const multipartComplete = async (env: Env, userId: string, path: string, uploadId: string,
                                        request: Request): Promise<Response> => {
    const body = await request.json().catch(() => null) as { parts?: Array<R2UploadedPart> } | null
    if (body === null || !Array.isArray(body.parts) || body.parts.length === 0
        || body.parts.some(part => !Number.isInteger(part.partNumber) || typeof part.etag !== "string")) {
        return json({error: "bad_parts"}, 400)
    }
    const upload = env.BUCKET.resumeMultipartUpload(keyFor(userId, path), uploadId)
    const object = await upload.complete(body.parts.map(({partNumber, etag}) => ({partNumber, etag})))
    return json({etag: object.etag})
}

export const multipartAbort = async (env: Env, userId: string, path: string, uploadId: string): Promise<Response> => {
    await env.BUCKET.resumeMultipartUpload(keyFor(userId, path), uploadId).abort()
    return json({ok: true})
}
