import {DefaultObservableValue, Errors, ObservableValue, Progress, RuntimeSignal, Terminable} from "@opendaw/lib-std"
import {CloudHandler} from "./CloudHandler"
import {EchoSessionExpired} from "./EchoCloudHandler"
import {CloudBackupSamples} from "./CloudBackupSamples"
import {CloudBackupProjects} from "./CloudBackupProjects"
import {CloudBackupTemplates} from "./CloudBackupTemplates"
import {CloudBackupSoundfonts} from "./CloudBackupSoundfonts"
import {CloudBackupPresets} from "./CloudBackupPresets"
import {CloudBackupScripts} from "./CloudBackupScripts"
import {CloudBackupWclaps} from "./CloudBackupWclaps"
import {CloudSyncHooks} from "./CloudSyncHooks"
import {CloudAuthManager} from "./CloudAuthManager"
import {ProjectSignals} from "../project/ProjectSignals"
import {ProjectStorage} from "../project/ProjectStorage"

// off: no storage server in this build. signed-out: not logged in, nothing is synced. idle: in sync as of the last run.
export type EchoSyncState = "off" | "signed-out" | "idle" | "syncing" | "error"

export type EchoSyncReason = "start" | "save" | "delete" | "visible" | "timer" | "manual"

export type EchoSyncDeps = {
    readonly enabled: boolean
    // a handler whose login is valid, or null. Never opens a login window.
    peek(): CloudHandler | null
    // opens the login window (only when the person asked for it)
    login(): Promise<CloudHandler>
    // one sync: what to upload, what to receive
    run(handler: CloudHandler, reason: EchoSyncReason): Promise<void>
    takeNotes(): ReadonlyArray<string>
    notify(message: string): void
    now(): number
}

/**
 * Keeps the projects of this device and the storage server in step without the person doing anything: right when the
 * app starts (and the login is still good), a moment after every save or delete, when the app comes back to the
 * front, and every few minutes. A sync is the same careful one as the manual Sync (it never overwrites a project that
 * changed in two places without asking), and only one runs at a time.
 */
export class EchoAutoSync {
    static readonly SaveDelay = 2000
    static readonly MinGapVisible = 60 * 1000
    static readonly MinGapTimer = 150 * 1000
    static readonly ErrorNoticeGap = 5 * 60 * 1000

    readonly #deps: EchoSyncDeps
    readonly #state: DefaultObservableValue<EchoSyncState>
    #chain: Promise<unknown> = Promise.resolve()
    #timer: ReturnType<typeof setTimeout> | undefined
    #lastSuccess: number = Number.NEGATIVE_INFINITY
    #lastErrorNotice: number = Number.NEGATIVE_INFINITY
    #pending: boolean = false

    constructor(deps: EchoSyncDeps) {
        this.#deps = deps
        this.#state = new DefaultObservableValue<EchoSyncState>(deps.enabled ? "signed-out" : "off")
    }

    get state(): ObservableValue<EchoSyncState> {return this.#state}

    get enabled(): boolean {return this.#deps.enabled}

    /**
     * Asks for a sync without the person waiting for it. A save or a delete waits a moment, so that a series of them
     * becomes one sync. Coming back to the front and the timer only sync when the last sync is not recent.
     */
    request(reason: EchoSyncReason): void {
        if (!this.#deps.enabled) {return}
        const gap = reason === "visible" ? EchoAutoSync.MinGapVisible : reason === "timer" ? EchoAutoSync.MinGapTimer : 0
        if (gap > 0 && this.#deps.now() - this.#lastSuccess < gap) {return}
        if (this.#pending) {return}
        const delay = reason === "save" || reason === "delete" ? EchoAutoSync.SaveDelay : 0
        this.#pending = true
        clearTimeout(this.#timer)
        this.#timer = setTimeout(() => {
            this.#pending = false
            void this.#enqueue(false, reason)
        }, delay)
    }

    /**
     * The person asked for a sync: logs in if needed, and reports problems to the caller instead of staying silent.
     */
    syncNow(): Promise<void> {
        if (!this.#deps.enabled) {return Promise.resolve()}
        return this.#enqueue(true, "manual")
    }

    /** Wires the triggers: saves and deletes, coming back to the front, a timer, and the first sync. */
    start(): Terminable {
        if (!this.#deps.enabled) {return Terminable.Empty}
        const subscription = RuntimeSignal.subscribe(signal => {
            if (signal === ProjectSignals.ProjectSaved) {this.request("save")}
            if (signal === ProjectSignals.ProjectDeleted) {this.request("delete")}
        })
        const onVisible = (): void => {if (document.visibilityState === "visible") {this.request("visible")}}
        const interval = setInterval(() => {if (document.visibilityState === "visible") {this.request("timer")}}, 60 * 1000)
        document.addEventListener("visibilitychange", onVisible)
        this.request("start")
        return {
            terminate: () => {
                subscription.terminate()
                clearInterval(interval)
                clearTimeout(this.#timer)
                document.removeEventListener("visibilitychange", onVisible)
            }
        }
    }

    #enqueue(interactive: boolean, reason: EchoSyncReason): Promise<void> {
        const task = (): Promise<void> => this.#execute(interactive, reason)
        const next = this.#chain.then(task, task) as Promise<void>
        this.#chain = next.catch(() => {})
        return next
    }

    async #execute(interactive: boolean, reason: EchoSyncReason): Promise<void> {
        let handler = this.#deps.peek()
        if (handler === null) {
            if (!interactive) {
                this.#state.setValue("signed-out")
                return
            }
            try {
                handler = await this.#deps.login()
            } catch (error) {
                this.#state.setValue("signed-out")
                // closing the login window is not a failure
                if (error === null || error === "cancelled" || Errors.isAbort(error)) {return}
                throw error
            }
        }
        this.#state.setValue("syncing")
        try {
            await this.#deps.run(handler, reason)
            this.#lastSuccess = this.#deps.now()
            this.#state.setValue("idle")
            const notes = this.#deps.takeNotes()
            if (notes.length > 0) {this.#deps.notify(notes.join("\n"))}
        } catch (error) {
            this.#deps.takeNotes()
            if (error instanceof EchoSessionExpired) {
                this.#state.setValue("signed-out")
                return
            }
            if (Errors.isAbort(error)) {
                this.#state.setValue("idle")
                return
            }
            console.warn("[EchoAutoSync]", error)
            this.#state.setValue("error")
            const now = this.#deps.now()
            if (interactive) {throw error}
            if (now - this.#lastErrorNotice >= EchoAutoSync.ErrorNoticeGap) {
                this.#lastErrorNotice = now
                this.#deps.notify(`Could not sync with the storage server: ${error instanceof Error ? error.message : String(error)}`)
            }
        }
    }

    // Everything the app wires in at its start.
    static create(auth: CloudAuthManager, notify: (message: string) => void): EchoAutoSync {
        const quiet = (): void => {}
        const signature = async (): Promise<string> => (await ProjectStorage.listProjects())
            .map(({uuid, meta}) => `${uuid}:${meta.modified}`).sort().join("|")
        const autoSync: EchoAutoSync = new EchoAutoSync({
            enabled: auth.echoEnabled,
            peek: () => auth.peekHandler("Echo"),
            login: () => auth.getHandler("Echo"),
            run: async (handler, reason) => {
                const before = await signature()
                // upload what the cloud is missing, without downloading all of it: audio comes when a project needs it
                await CloudBackupSamples.start(handler, Progress.Empty, quiet, {download: false})
                await CloudBackupProjects.start(handler, "Echo", Progress.Empty, quiet, {confirmDeletes: false})
                if (reason === "manual") {
                    // the Sync button also brings the rest along: templates, soundfonts, presets, scripts, plug-ins
                    await CloudBackupTemplates.start(handler, Progress.Empty, quiet)
                    await CloudBackupSoundfonts.start(handler, Progress.Empty, quiet)
                    await CloudBackupPresets.start(handler, Progress.Empty, quiet)
                    await CloudBackupScripts.start(handler, Progress.Empty, quiet)
                    await CloudBackupWclaps.start(handler, Progress.Empty, quiet)
                }
                // what came down, or went away, changes what the dashboard shows
                if (before !== await signature()) {RuntimeSignal.dispatch(ProjectSignals.StorageUpdated)}
            },
            takeNotes: () => CloudSyncHooks.takeNotes(),
            notify,
            now: () => Date.now()
        })
        // a login (also one made from the Sync button) starts a sync
        auth.subscribeHandler(() => autoSync.request("start"))
        return autoSync
    }
}
