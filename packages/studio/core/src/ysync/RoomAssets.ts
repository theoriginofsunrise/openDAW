import {Errors, Progress, UUID} from "@opendaw/lib-std"
import {AudioData, WavFile} from "@opendaw/lib-dsp"
import {SampleMetaData} from "@opendaw/studio-adapters"

/**
 * The audio files of a live room, handed from one person to the next through a shared folder on our server, so that it
 * does not depend on a direct connection between the two devices (which a phone network often does not allow).
 * A file is stored under the room's name; it is deleted a day later.
 */
export class RoomAssets {
    static readonly PollMs = 2000
    // somebody may still be recording: the file appears when they stop
    static readonly PatienceMs = 5 * 60 * 1000

    readonly #base: string
    readonly #room: string
    readonly #token: () => string | null
    readonly #fetch: typeof fetch

    constructor(serverUrl: string, room: string, token: () => string | null,
                fetcher: typeof fetch = (input, init) => fetch(input, init)) {
        this.#base = serverUrl.replace(/^ws/i, "http").replace(/\/+$/, "")
        this.#room = room
        this.#token = token
        this.#fetch = fetcher
    }

    async exists(uuid: string): Promise<boolean> {
        const response = await this.#send(this.#path(uuid, "meta.json"), {method: "HEAD"})
        if (response.status === 404) {return false}
        if (!response.ok) {throw new Error(`Room assets: ${response.status}`)}
        return true
    }

    // The audio first, then what describes it: whoever finds the description finds the whole file.
    async upload(uuid: string, wav: ArrayBuffer, meta: string): Promise<void> {
        for (const [name, data] of [["audio.wav", wav], ["meta.json", new TextEncoder().encode(meta).buffer as ArrayBuffer]] as const) {
            const response = await this.#send(this.#path(uuid, name), {
                method: "PUT", body: data, headers: {"Content-Type": "application/octet-stream"}
            })
            if (!response.ok) {throw new Error(`Room assets upload of ${name}: ${response.status} ${await response.text()}`)}
        }
    }

    /**
     * Waits for the file to show up (it may still be recorded), gets it, and gives it the way the sample loader wants it.
     * Gives up when the signal is aborted (another way of getting the file was quicker), or after the patience ran out.
     */
    async fetchSample(uuid: UUID.Bytes, progress: Progress.Handler, signal?: AbortSignal,
                      sleep: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms)),
                      patienceMs: number = RoomAssets.PatienceMs): Promise<[AudioData, SampleMetaData]> {
        const id = UUID.toString(uuid)
        let waited = 0
        // asked again each time: it can change while we wait for the network
        const aborted = (): boolean => signal?.aborted === true
        for (; ;) {
            if (aborted()) {throw Errors.AbortError}
            const meta = await this.#send(this.#path(id, "meta.json"))
            if (meta.ok) {
                const description = await meta.json() as SampleMetaData
                if (aborted()) {throw Errors.AbortError}
                progress(0.3)
                const audio = await this.#send(this.#path(id, "audio.wav"))
                if (!audio.ok) {throw new Error(`Room assets: ${audio.status}`)}
                const buffer = await audio.arrayBuffer()
                progress(0.9)
                return [WavFile.decodeFloats(buffer), description]
            }
            if (meta.status !== 404) {throw new Error(`Room assets: ${meta.status}`)}
            if (waited >= patienceMs) {throw new Errors.FileNotFound(`sample ${id} was not handed over in the room`)}
            await sleep(RoomAssets.PollMs)
            waited += RoomAssets.PollMs
        }
    }

    #path(uuid: string, name: string): string {
        return `/shared/rooms/${encodeURIComponent(this.#room)}/samples/${uuid}/${name}`
    }

    async #send(path: string, init: RequestInit = {}): Promise<Response> {
        const token = this.#token()
        if (token === null) {throw new Error("Not signed in")}
        return this.#fetch(`${this.#base}${path}`, {
            ...init, headers: {...(init.headers as Record<string, string> | undefined), Authorization: `Bearer ${token}`}
        })
    }
}

// What comes first: the first of the fetches that delivers. The others are told to stop (the signal).
export const firstOf = <T>(starts: ReadonlyArray<(signal: AbortSignal) => Promise<T>>): Promise<T> => {
    const controller = new AbortController()
    return new Promise<T>((resolve, reject) => {
        let failed = 0
        let lastError: unknown = new Error("No way to get it")
        starts.forEach(start => start(controller.signal).then(value => {
            controller.abort()
            resolve(value)
        }, error => {
            lastError = error
            if (++failed === starts.length) {reject(lastError)}
        }))
        if (starts.length === 0) {reject(lastError)}
    })
}
