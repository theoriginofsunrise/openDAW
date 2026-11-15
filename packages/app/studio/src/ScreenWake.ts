import {ObservableValue, Terminable} from "@opendaw/lib-std"

// Phone fork: a phone that locks its screen suspends the page, and the recording stops with it. While the engine
// counts in or records, the screen is kept on (Screen Wake Lock; Safari 16.4+, Home Screen apps from iOS 18.4).
export namespace ScreenWake {
    type Recording = {
        readonly isRecording: ObservableValue<boolean>
        readonly isCountingIn: ObservableValue<boolean>
    }

    export const install = (engine: Recording): Terminable => {
        let sentinel: WakeLockSentinel | null = null
        let wanted = false
        const request = async (): Promise<void> => {
            if (!wanted || sentinel !== null || !("wakeLock" in navigator)) {return}
            if (document.visibilityState !== "visible") {return}
            try {
                const lock = await navigator.wakeLock.request("screen")
                if (!wanted) {return void lock.release()}
                sentinel = lock
                lock.addEventListener("release", () => {if (sentinel === lock) {sentinel = null}})
            } catch (error) {
                console.warn("The screen could not be kept awake", error)
            }
        }
        const release = (): void => {
            wanted = false
            const lock = sentinel
            sentinel = null
            lock?.release().catch(() => {})
        }
        const update = (): void => {
            if (engine.isRecording.getValue() || engine.isCountingIn.getValue()) {
                wanted = true
                void request()
            } else {
                release()
            }
        }
        // the lock is dropped whenever the page is hidden: take it again when the page is back in front
        const visibility = (): void => {if (document.visibilityState === "visible") {void request()}}
        document.addEventListener("visibilitychange", visibility)
        update()
        return Terminable.many(
            engine.isRecording.subscribe(update),
            engine.isCountingIn.subscribe(update),
            {
                terminate: () => {
                    document.removeEventListener("visibilitychange", visibility)
                    release()
                }
            }
        )
    }
}
