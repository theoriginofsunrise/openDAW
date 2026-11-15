import {UUID} from "@opendaw/lib-std"

// For every project: the "modified" stamp the cloud copy had when this device last synced it (downloaded it, or
// uploaded it). It is what tells apart "I changed it" from "somebody else changed it": a stamp that differs from
// this one in the cloud means the cloud copy was saved by someone else since.
export namespace CloudSyncBase {
    type Record = { [uuid: UUID.String]: string }

    const key = (service: string): string => `opendaw-sync-base:${service}`

    export const load = (service: string): Record => {
        try {
            const parsed: unknown = JSON.parse(localStorage.getItem(key(service)) ?? "{}")
            return typeof parsed === "object" && parsed !== null ? parsed as Record : {}
        } catch (_error) {
            return {}
        }
    }

    const store = (service: string, record: Record): void => {
        try {localStorage.setItem(key(service), JSON.stringify(record))} catch (_error) {/* storage not available */}
    }

    export const set = (service: string, uuid: UUID.String, modified: string): void => {
        const record = load(service)
        record[uuid] = modified
        store(service, record)
    }

    export const remove = (service: string, uuid: UUID.String): void => {
        const record = load(service)
        delete record[uuid]
        store(service, record)
    }

    // What to do with a project that exists on both sides, from three stamps: the local copy's, the cloud copy's, and
    // the one the cloud copy had at the last sync (undefined: this device has never synced the project).
    //   same            nothing to do
    //   upload          only this device changed it
    //   download        only somebody else changed it
    //   both-changed    both did: somebody has to decide
    //   unknown-history different, and no way to tell who changed it: somebody has to decide
    export type Verdict = "same" | "upload" | "download" | "both-changed" | "unknown-history"

    export const verdict = (local: string, cloud: string, base: string | undefined): Verdict => {
        if (local === cloud) {return "same"}
        if (base === undefined) {return "unknown-history"}
        const changedHere = local !== base
        const changedInCloud = cloud !== base
        if (changedHere && !changedInCloud) {return "upload"}
        if (!changedHere && changedInCloud) {return "download"}
        return "both-changed"
    }
}
