import {Browser} from "@opendaw/lib-dom"
import {Errors, UUID} from "@opendaw/lib-std"
import {CloudHandler} from "./CloudHandler"

export type PresenceNote = {
    // readable name of the device that has the project open
    readonly device: string
    // one browser, one session (Browser.id())
    readonly session: string
    readonly project: string
    // when this device opened the project
    readonly since: string
    // last heartbeat
    readonly seen: string
}

// "Who has this project open right now?" Every device that has the project open keeps a small note of its own in
// the cloud and renews it every minute. A note that was not renewed for a while belongs to a device that closed the
// project, went to the background, or lost its connection. It is a courtesy warning, not a lock: the sync checks
// for conflicting changes on its own, whatever the notes say.
export namespace CloudPresence {
    export const Folder = "presence"
    export const HeartbeatMs = 60_000
    export const StaleAfterMs = 150_000
    const DeleteAfterMs = 24 * 60 * 60 * 1000
    const DeviceNameKey = "opendaw-device-name"

    const folder = (uuid: UUID.String): string => `${Folder}/${uuid}`
    const file = (uuid: UUID.String, session: string): string => `${folder(uuid)}/${session}.json`

    export const deviceName = (): string => {
        try {
            const stored = localStorage.getItem(DeviceNameKey)
            if (stored !== null && stored !== "") {return stored}
        } catch (_error) {/* storage not available */}
        const agent = navigator.userAgent
        const kind = /iPhone/i.test(agent) ? "iPhone"
            : /iPad/i.test(agent) ? "iPad"
                : /Android/i.test(agent) ? "Android phone"
                    : /Macintosh/i.test(agent) ? "Mac"
                        : /Windows/i.test(agent) ? "Windows PC"
                            : /Linux/i.test(agent) ? "Linux PC" : "Browser"
        return `${kind} ${Browser.id().slice(0, 4)}`
    }

    export const isOwn = (note: PresenceNote): boolean => note.session === Browser.id()
    export const isFresh = (note: PresenceNote, now: number = Date.now()): boolean =>
        now - new Date(note.seen).getTime() < StaleAfterMs

    // The notes of the OTHER sessions that renewed theirs recently. Old ones are cleaned up on the way.
    export const others = async (handler: CloudHandler, uuid: UUID.String): Promise<ReadonlyArray<PresenceNote>> => {
        let names: ReadonlyArray<string>
        try {
            names = await handler.list(folder(uuid))
        } catch (error) {
            if (error instanceof Errors.FileNotFound) {return []}
            throw error
        }
        const own = `${Browser.id()}.json`
        const result: Array<PresenceNote> = []
        for (const name of names) {
            if (!name.endsWith(".json") || name === own) {continue}
            try {
                const note: PresenceNote = JSON.parse(new TextDecoder().decode(await handler.download(`${folder(uuid)}/${name}`)))
                if (isFresh(note)) {
                    result.push(note)
                } else if (Date.now() - new Date(note.seen).getTime() > DeleteAfterMs) {
                    await handler.delete(`${folder(uuid)}/${name}`).catch(() => {})
                }
            } catch (_error) {/* unreadable or gone: nothing to warn about */}
        }
        return result
    }

    export const renew = async (handler: CloudHandler, uuid: UUID.String,
                                project: string, since: string): Promise<void> => {
        const note: PresenceNote = {device: deviceName(), session: Browser.id(), project, since, seen: new Date().toISOString()}
        await handler.upload(file(uuid, note.session), new TextEncoder().encode(JSON.stringify(note)).buffer as ArrayBuffer)
    }

    export const clear = async (handler: CloudHandler, uuid: UUID.String): Promise<void> => {
        await handler.delete(file(uuid, Browser.id())).catch(() => {})
    }
}
