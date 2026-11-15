import {createElement} from "@opendaw/lib-jsx"
import {Lifecycle, RuntimeSignal} from "@opendaw/lib-std"
import {IconSymbol} from "@opendaw/studio-enums"
import {CloudBackup, CloudSyncStatus, ProjectSignals, SyncStatus} from "@opendaw/studio-core"
import {Icon} from "@/ui/components/Icon"
import type {StudioService} from "@/service/StudioService"

type Construct = {
    lifecycle: Lifecycle
    service: StudioService
}

type State = "unknown" | "synced" | "pending" | "busy"

const Service = "GoogleDrive" as const
const StateClasses: ReadonlyArray<State> = ["unknown", "synced", "pending", "busy"]

// Phone fork: one tap sync with Google Drive. Green: everything is in sync. Red: something has to go up, come down,
// or needs a decision. Blue: not logged in (or no network), so nothing is known: tap to log in and sync.
// The colour covers the projects. Samples and other resources travel with the same sync.
export const SyncButton = ({lifecycle, service}: Construct) => {
    const label: HTMLElement = <span>Sync</span>
    const button: HTMLElement = (
        <button className="action sync unknown" title="Log in to Google Drive and sync." onclick={() => void run()}>
            <Icon symbol={IconSymbol.GoogleDrive}/>
            {label}
        </button>
    )
    let busy = false
    let generation = 0
    let timer: ReturnType<typeof setTimeout> | undefined

    const show = (state: State, status?: SyncStatus): void => {
        StateClasses.forEach(name => button.classList.toggle(name, name === state))
        label.textContent = state === "busy" ? "Syncing..."
            : state === "pending" && status !== undefined ? `Sync (${status.count})` : "Sync"
        button.title = state === "busy" ? "Syncing with Google Drive..."
            : state === "synced" ? "Everything is in sync with Google Drive."
                : state === "pending" && status !== undefined
                    ? `To upload: ${status.push.length}, to download: ${status.pull.length}, `
                    + `to decide: ${status.decide.length}, deletions: ${status.deletions.length}. Tap to sync.`
                    : "Log in to Google Drive and sync."
    }

    const refresh = async (): Promise<void> => {
        if (busy) {return}
        const current = ++generation
        const handler = service.cloudAuthManager.peekHandler(Service)
        if (handler === null) {
            show("unknown")
            return
        }
        try {
            const status = await CloudSyncStatus.check(handler, Service)
            if (current === generation && !busy) {show(status.count === 0 ? "synced" : "pending", status)}
        } catch (error) {
            console.warn("Sync status unavailable", error)
            if (current === generation && !busy) {show("unknown")}
        }
    }

    const run = async (): Promise<void> => {
        if (busy) {return}
        busy = true
        show("busy")
        try {
            await CloudBackup.backup(service.cloudAuthManager, Service)
        } catch (_error) {
            // the backup already told the person what went wrong
        } finally {
            busy = false
            void refresh()
        }
    }

    const schedule = (): void => {
        clearTimeout(timer)
        timer = setTimeout(() => void refresh(), 800)
    }
    const onVisible = (): void => {if (document.visibilityState === "visible") {schedule()}}
    const interval = setInterval(() => void refresh(), 120_000)
    document.addEventListener("visibilitychange", onVisible)
    lifecycle.ownAll(
        service.cloudAuthManager.subscribeHandler(schedule),
        RuntimeSignal.subscribe(signal => signal === ProjectSignals.StorageUpdated && schedule()),
        {
            terminate: () => {
                clearInterval(interval)
                clearTimeout(timer)
                document.removeEventListener("visibilitychange", onVisible)
            }
        }
    )
    void refresh()
    return button
}
