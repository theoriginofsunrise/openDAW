import {UUID} from "@opendaw/lib-std"

export type ConflictReason = "both-changed" | "unknown-history"

export type ConflictInfo = {
    readonly uuid: UUID.String
    readonly name: string
    // when the copy on this device was last saved
    readonly local: string
    // when the copy in the cloud was last saved
    readonly cloud: string
    readonly reason: ConflictReason
    // the project is open in the editor right now
    readonly open: boolean
}

// keep-both: this device's version is kept as a separate project ("conflict copy") and the cloud version takes over
// use-cloud: this device's changes are dropped, the cloud version takes over
// use-mine: this device's version replaces the cloud version
// skip: nothing changes, the question comes back at the next sync
export type ConflictChoice = "keep-both" | "use-cloud" | "use-mine" | "skip"

export interface CloudSyncHooks {
    resolveConflict(info: ConflictInfo): Promise<ConflictChoice>
    // a project that is open in the editor cannot be replaced underneath it
    isProjectOpen(uuid: UUID.String): boolean
    // saves this device's version as a new local project and returns its name
    createConflictCopy(uuid: UUID.String): Promise<string>
}

// The sync lives in this package, the questions it has to ask live in the app: the app installs its answers here.
// Until then every conflict is skipped, so nothing is ever overwritten without a decision.
export namespace CloudSyncHooks {
    let current: CloudSyncHooks = {
        resolveConflict: () => Promise.resolve("skip"),
        isProjectOpen: () => false,
        createConflictCopy: () => Promise.reject("No conflict copy available")
    }
    const notes: Array<string> = []

    export const install = (hooks: CloudSyncHooks): void => {current = hooks}
    export const get = (): CloudSyncHooks => current
    // lines for the summary that is shown when a sync ends
    export const note = (line: string): void => {notes.push(line)}
    export const takeNotes = (): ReadonlyArray<string> => notes.splice(0, notes.length)
}
