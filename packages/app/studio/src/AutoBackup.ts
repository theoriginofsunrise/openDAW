import {Terminable} from "@opendaw/lib-std"
import {Workers} from "@opendaw/studio-core"
import {StudioService} from "@/service/StudioService"

// Phone fork: closing the app (or the phone closing it for you) must not lose work that was never saved.
// While the open project has unsaved changes, a copy is written to the studio's recovery slot every few seconds
// and whenever the page goes to the background. At the next start the studio restores that copy, still marked as
// unsaved, so nothing happens behind your back: the saved project stays what you saved, and "Save" stays your call.
export namespace AutoBackup {
    const IntervalMs = 20_000
    // the folder the studio's recovery code (Recovery.ts) writes to and reads from
    const BackupPath = ".backup"

    let flushNow: (() => Promise<void>) | null = null

    // Writes the backup right now (before a restart, for example).
    export const flush = async (): Promise<void> => {await flushNow?.()}

    export const install = (service: StudioService): Terminable => {
        let busy = false
        let written = false

        // A backup that no longer matches anything (saved, or another project opened) must not come back later.
        const clear = async (): Promise<void> => {
            if (!written) {return}
            written = false
            await Workers.Opfs.delete(BackupPath).catch(() => {})
        }

        const backup = async (): Promise<void> => {
            if (busy || !service.hasProfile) {return}
            // do not take the processor's time while recording, unless the page is about to be suspended
            if (service.engine.isRecording.getValue() && document.visibilityState === "visible") {return}
            if (!service.profile.hasUnsavedChanges()) {return clear()}
            const command = service.recovery.createBackupCommand()
            if (command.isEmpty()) {return}
            busy = true
            try {
                await command.unwrap()()
                written = true
            } catch (error) {
                console.warn("Automatic backup failed", error)
            } finally {
                busy = false
            }
        }

        flushNow = backup
        const onHidden = (): void => {if (document.visibilityState === "hidden") {void backup()}}
        const onPageHide = (): void => {void backup()}
        const timer = setInterval(() => void backup(), IntervalMs)
        document.addEventListener("visibilitychange", onHidden)
        window.addEventListener("pagehide", onPageHide)
        return Terminable.many(
            service.projectProfileService.subscribe(() => void clear()),
            {
                terminate: () => {
                    clearInterval(timer)
                    document.removeEventListener("visibilitychange", onHidden)
                    window.removeEventListener("pagehide", onPageHide)
                }
            }
        )
    }
}
