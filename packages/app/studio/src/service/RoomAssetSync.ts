import {Terminable} from "@opendaw/lib-std"

export type RoomAssetSyncDeps = {
    // the audio files the project in the room uses (their ids)
    listIds(): ReadonlyArray<string>
    // the file is stored on this device (a recording that is still going is not, yet)
    hasLocal(id: string): Promise<boolean>
    // the file as stored, and what describes it
    readLocal(id: string): Promise<{ wav: ArrayBuffer, meta: string }>
    // what the room's shared folder already has
    exists(id: string): Promise<boolean>
    upload(id: string, wav: ArrayBuffer, meta: string): Promise<void>
    warn(message: string, error: unknown): void
}

/**
 * Puts the audio files of this device in the room's shared folder, so that the others can take them from there. Looks
 * every few seconds: a file that is recorded or imported appears in the project first and on the disk when it is done.
 * A file is put there once, and only when nobody else has put it there yet.
 */
export class RoomAssetSync implements Terminable {
    readonly #deps: RoomAssetSyncDeps
    readonly #done = new Set<string>()
    readonly #failures = new Map<string, number>()
    readonly #interval: ReturnType<typeof setInterval>
    #busy = false
    #terminated = false

    constructor(deps: RoomAssetSyncDeps, intervalMs: number = 3000) {
        this.#deps = deps
        this.#interval = setInterval(() => void this.scan(), intervalMs)
        void this.scan()
    }

    async scan(): Promise<void> {
        if (this.#busy || this.#terminated) {return}
        this.#busy = true
        try {
            for (const id of this.#deps.listIds()) {
                if (this.#terminated) {return}
                if (this.#done.has(id) || (this.#failures.get(id) ?? 0) >= 5) {continue}
                try {
                    if (!await this.#deps.hasLocal(id)) {continue}
                    if (await this.#deps.exists(id)) {
                        this.#done.add(id)
                        continue
                    }
                    const {wav, meta} = await this.#deps.readLocal(id)
                    await this.#deps.upload(id, wav, meta)
                    this.#done.add(id)
                } catch (error) {
                    const count = (this.#failures.get(id) ?? 0) + 1
                    this.#failures.set(id, count)
                    this.#deps.warn(`Could not hand ${id} to the room (try ${count} of 5)`, error)
                }
            }
        } finally {
            this.#busy = false
        }
    }

    terminate(): void {
        this.#terminated = true
        clearInterval(this.#interval)
    }
}
