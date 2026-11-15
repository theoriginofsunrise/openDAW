import {Terminable} from "@opendaw/lib-std"
import {AudioContexts} from "@opendaw/studio-core"

// Phone fork: when another app uses the audio (a call, a voice memo, a video), iOS takes it away from the page and
// Play stays silent. Ask for it back whenever the page returns to the front, without any dialog. The Play button
// asks again, and offers a restart if the audio is still not available.
export namespace AudioRecovery {
    export const install = (context: AudioContext): Terminable => {
        const onVisible = (): void => {
            if (document.visibilityState !== "visible" || context.state === "running") {return}
            void AudioContexts.resume(context, {silent: true})
        }
        const onState = (): void => console.debug(`AudioContext state: ${context.state}`)
        document.addEventListener("visibilitychange", onVisible)
        context.addEventListener("statechange", onState)
        return {
            terminate: () => {
                document.removeEventListener("visibilitychange", onVisible)
                context.removeEventListener("statechange", onState)
            }
        }
    }
}
