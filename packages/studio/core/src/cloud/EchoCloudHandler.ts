import {Errors, panic, Progress} from "@opendaw/lib-std"
import {CloudHandler} from "./CloudHandler"

export class EchoSessionExpired extends Error {
    constructor() {super("Your login with the storage server ended. Sign in again.")}
}

export class EchoPreconditionFailed extends Error {
    constructor(readonly path: string) {super(`'${path}' was changed by someone else in the meantime.`)}
}

// The files that every device reads, changes and writes back (catalogs, deletion records). A write to one of them is
// only accepted when it starts from the version the device last read, so that two devices cannot overwrite each other.
const SharedFiles: ReadonlySet<string> = new Set(["index.json", "tombstones.json", "structure.json"])

export const isSharedFile = (path: string): boolean => SharedFiles.has(path.slice(path.lastIndexOf("/") + 1))

/**
 * The cloud storage of the Echo server (Cloudflare Workers + R2). Same contract as the Google Drive and Dropbox
 * handlers, so everything the sync does works unchanged.
 */
export class EchoCloudHandler implements CloudHandler {
    // up to this size a file goes up in one request, bigger ones in parts (Cloudflare accepts 100 MB per request)
    static readonly SingleLimit = 64 * 1024 * 1024
    // every part but the last must have exactly this size (the storage needs at least 5 MB per part)
    static readonly PartSize = 32 * 1024 * 1024

    readonly #serverUrl: string
    readonly #token: string
    readonly #fetch: typeof fetch
    readonly #onUnauthorized: () => void
    readonly #singleLimit: number
    readonly #partSize: number
    // the version of every shared file as this device last saw it
    readonly #versions = new Map<string, string>()

    constructor(serverUrl: string, token: string, fetcher: typeof fetch = (input, init) => fetch(input, init),
                onUnauthorized: () => void = () => {},
                limits: { singleLimit?: number, partSize?: number } = {}) {
        this.#serverUrl = serverUrl.replace(/\/+$/, "")
        this.#token = token
        this.#fetch = fetcher
        this.#onUnauthorized = onUnauthorized
        this.#singleLimit = limits.singleLimit ?? EchoCloudHandler.SingleLimit
        this.#partSize = limits.partSize ?? EchoCloudHandler.PartSize
    }

    async alive(): Promise<void> {
        const response = await this.#send("/auth/me")
        if (!response.ok) {return panic(`Echo server did not answer properly: ${response.status}`)}
    }

    async upload(path: string, data: ArrayBuffer, progress: Progress.Handler = Progress.Empty): Promise<void> {
        if (data.byteLength > this.#singleLimit) {return this.#uploadInParts(path, data, progress)}
        const headers: Record<string, string> = {"Content-Type": "application/octet-stream"}
        const known = this.#versions.get(path)
        if (isSharedFile(path) && known !== undefined) {headers["X-Echo-If-Match"] = known}
        const response = await this.#send(`/files/${EchoCloudHandler.#encode(path)}`, {method: "PUT", body: data, headers})
        if (response.status === 412) {throw new EchoPreconditionFailed(path)}
        if (!response.ok) {return panic(`Echo upload failed: ${response.status} ${await response.text()}`)}
        const {etag} = await response.json() as { etag: string }
        if (isSharedFile(path)) {this.#versions.set(path, etag)}
        progress(1.0)
    }

    async download(path: string): Promise<ArrayBuffer> {
        const response = await this.#send(`/files/${EchoCloudHandler.#encode(path)}`)
        if (response.status === 404) {throw new Errors.FileNotFound(path)}
        if (!response.ok) {return panic(`Echo download failed: ${response.status} ${await response.text()}`)}
        const etag = response.headers.get("ETag")
        if (isSharedFile(path)) {
            if (etag === null) {this.#versions.delete(path)} else {this.#versions.set(path, etag.replace(/"/g, ""))}
        }
        return response.arrayBuffer()
    }

    async exists(path: string): Promise<boolean> {
        const response = await this.#send(`/files/${EchoCloudHandler.#encode(path)}`, {method: "HEAD"})
        if (response.status === 404) {return false}
        if (!response.ok) {return panic(`Echo exists failed: ${response.status}`)}
        return true
    }

    async list(path?: string): Promise<string[]> {
        const response = await this.#send(`/list?path=${encodeURIComponent(path ?? "")}`)
        if (!response.ok) {return panic(`Echo list failed: ${response.status} ${await response.text()}`)}
        return (await response.json() as { names: Array<string> }).names
    }

    async delete(path: string): Promise<void> {
        const response = await this.#send(`/files/${EchoCloudHandler.#encode(path)}`, {method: "DELETE"})
        if (!response.ok) {return panic(`Echo delete failed: ${response.status} ${await response.text()}`)}
        this.#versions.delete(path)
    }

    // Forget what this device knows about the version of a file, so that the next write does not check it. Only for
    // when the person decided to replace the cloud copy.
    forgetVersion(path: string): void {this.#versions.delete(path)}

    async #uploadInParts(path: string, data: ArrayBuffer, progress: Progress.Handler): Promise<void> {
        const query = `path=${encodeURIComponent(path)}`
        const created = await this.#send(`/mpu/create?${query}`, {method: "POST"})
        if (!created.ok) {return panic(`Echo upload could not start: ${created.status} ${await created.text()}`)}
        const {uploadId} = await created.json() as { uploadId: string }
        try {
            const parts: Array<{ partNumber: number, etag: string }> = []
            const count = Math.ceil(data.byteLength / this.#partSize)
            for (let index = 0; index < count; index++) {
                const start = index * this.#partSize
                const chunk = data.slice(start, Math.min(data.byteLength, start + this.#partSize))
                const response = await this.#send(`/mpu/part?${query}&uploadId=${encodeURIComponent(uploadId)}&part=${index + 1}`,
                    {method: "PUT", body: chunk, headers: {"Content-Type": "application/octet-stream"}})
                if (!response.ok) {return panic(`Echo upload failed in part ${index + 1}: ${response.status} ${await response.text()}`)}
                parts.push(await response.json() as { partNumber: number, etag: string })
                progress((index + 1) / count)
            }
            const done = await this.#send(`/mpu/complete?${query}&uploadId=${encodeURIComponent(uploadId)}`,
                {method: "POST", body: JSON.stringify({parts}), headers: {"Content-Type": "application/json"}})
            if (!done.ok) {return panic(`Echo upload could not finish: ${done.status} ${await done.text()}`)}
            const {etag} = await done.json() as { etag: string }
            if (isSharedFile(path)) {this.#versions.set(path, etag)}
        } catch (error) {
            await this.#send(`/mpu/abort?${query}&uploadId=${encodeURIComponent(uploadId)}`, {method: "POST"}).catch(() => {})
            throw error
        }
    }

    async #send(route: string, init: RequestInit = {}): Promise<Response> {
        const response = await this.#fetch(`${this.#serverUrl}${route}`, {
            ...init, headers: {...(init.headers as Record<string, string> | undefined), Authorization: `Bearer ${this.#token}`}
        })
        if (response.status === 401) {
            this.#onUnauthorized()
            throw new EchoSessionExpired()
        }
        return response
    }

    static #encode(path: string): string {
        return path.split("/").filter(part => part.length > 0).map(encodeURIComponent).join("/")
    }
}
