import {createElement} from "@opendaw/lib-jsx"
import {Lifecycle, RuntimeNotifier, RuntimeSignal} from "@opendaw/lib-std"
import {IconSymbol} from "@opendaw/studio-enums"
import {CloudBackup, CloudSyncStatus, ProjectSignals, SyncStatus} from "@opendaw/studio-core"
import {Icon} from "@/ui/components/Icon"
import {EchoSync} from "@/EchoSync"
import type {StudioService} from "@/service/StudioService"

type Construct = {
    lifecycle: Lifecycle
    service: StudioService
}

type State = "unknown" | "synced" | "pending" | "busy"

const StateClasses: ReadonlyArray<State> = ["unknown", "synced", "pending", "busy"]

// Phone fork: the Sync button. With our own storage server (Cloudflare) in the build the sync runs by itself (at the
// start, after every save, ...) and the button shows how it stands; a tap syncs everything now and, when nobody is
// signed in, asks for the login. Without that server it syncs with Google Drive, as before.
// Green: everything is in sync. Red: something has to go up, come down, or needs a decision (or the last sync failed).
// Blue: not signed in, so nothing is known.
// The colour covers the projects. Samples and other resources travel with the same sync.
export const SyncButton = ({lifecycle, service}: Construct) => {
    const auth = service.cloudAuthManager
    const echo = auth.echoEnabled
    const cloud = echo ? "Echo" : "GoogleDrive"
    const autoSync = echo ? EchoSync.get() : null
    const signIn = echo ? "Sign in" : "Sync"
    const label: HTMLElement = <span>{signIn}</span>
    const button: HTMLElement = (
        <button className="action sync unknown"
                title={echo ? "Sign in with Google to keep your projects on the storage server." : "Log in to Google Drive and sync."}
                onclick={() => void run()}>
            <Icon symbol={IconSymbol.GoogleDrive}/>
            {label}
        </button>
    )
    let busy = false
    let generation = 0
    let timer: ReturnType<typeof setTimeout> | undefined

    const isBusy = (): boolean => busy || autoSync?.state.getValue() === "syncing"

    const show = (state: State, status?: SyncStatus): void => {
        StateClasses.forEach(name => button.classList.toggle(name, name === state))
        label.textContent = state === "busy" ? "Syncing..."
            : state === "pending" && status !== undefined ? `Sync (${status.count})`
                : state === "unknown" ? signIn : "Sync"
        button.title = state === "busy" ? "Syncing..."
            : state === "synced" ? (echo ? "Everything is in sync with the storage server." : "Everything is in sync with Google Drive.")
                : state === "pending" && status !== undefined
                    ? `To upload: ${status.push.length}, to download: ${status.pull.length}, `
                    + `to decide: ${status.decide.length}, deletions: ${status.deletions.length}. Tap to sync.`
                    : echo ? "Sign in with Google to keep your projects on the storage server." : "Log in to Google Drive and sync."
    }

    const refresh = async (): Promise<void> => {
        if (isBusy()) {return}
        const current = ++generation
        const handler = auth.peekHandler(cloud)
        if (handler === null) {
            show("unknown")
            return
        }
        // the last background sync did not work: say so, a tap tries again
        if (autoSync?.state.getValue() === "error") {
            label.textContent = "Retry sync"
            StateClasses.forEach(name => button.classList.toggle(name, name === "pending"))
            button.title = "The last sync with the storage server failed. Tap to try again."
            return
        }
        try {
            const status = await CloudSyncStatus.check(handler, cloud)
            if (current === generation && !isBusy()) {show(status.count === 0 ? "synced" : "pending", status)}
        } catch (error) {
            console.warn("Sync status unavailable", error)
            if (current === generation && !isBusy()) {show("unknown")}
        }
    }

    const run = async (): Promise<void> => {
        if (isBusy()) {return}
        busy = true
        show("busy")
        try {
            if (echo) {
                await autoSync?.syncNow()
            } else {
                await CloudBackup.backup(auth, "GoogleDrive")
            }
        } catch (error) {
            console.warn(error)
            await RuntimeNotifier.info({
                headline: "Sync failed",
                message: error instanceof Error ? error.message : String(error)
            })
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
        auth.subscribeHandler(schedule),
        RuntimeSignal.subscribe(signal => signal === ProjectSignals.StorageUpdated && schedule()),
        {
            terminate: () => {
                clearInterval(interval)
                clearTimeout(timer)
                document.removeEventListener("visibilitychange", onVisible)
            }
        }
    )
    if (autoSync !== null) {
        // the background sync starts and ends: show it, and look again how things stand when it is over
        lifecycle.own(autoSync.state.subscribe(owner => {
            if (owner.getValue() === "syncing") {show("busy")} else {schedule()}
        }))
        if (autoSync.state.getValue() === "syncing") {show("busy")}
    }
    void refresh()
    return button
}
