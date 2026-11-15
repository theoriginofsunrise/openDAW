import {Promises} from "@opendaw/lib-runtime"
import {RuntimeNotifier} from "@opendaw/lib-std"

export class AudioContexts {
    static #failureNotified: boolean = false

    // Installed by the app: saves the work and reloads the page, which always brings the audio back.
    static restart: (() => Promise<void>) | null = null

    static async resume(context: AudioContext, options: { silent?: boolean } = {}): Promise<boolean> {
        // Safari adds an "interrupted" state (another app, a call or Siri took the audio) that the typings omit
        const state: string = context.state
        if (state === "running") {return true}
        if (state === "closed") {return false}
        // resume() can stay pending for as long as the audio is taken: never wait for it forever
        const result = await Promise.race([
            Promises.tryCatch(context.resume()),
            new Promise<"timeout">(resolve => setTimeout(() => resolve("timeout"), 2000))
        ])
        if (result !== "timeout" && result.status === "rejected") {
            console.warn("AudioContext.resume rejected", result.error, {
                state: context.state,
                sampleRate: context.sampleRate,
                hardwareSampleRate: await this.#probeHardwareSampleRate()
            })
            if (!options.silent && !this.#failureNotified) {
                this.#failureNotified = true
                RuntimeNotifier.info({
                    headline: "Audio Device Unavailable",
                    message: "Your browser could not start the audio device. Check your audio output settings and try again."
                }).then(() => {this.#failureNotified = false})
            }
            return false
        }
        const resumed: boolean = context.state === "running"
        if (!resumed && !options.silent) {await this.#offerRestart()}
        return resumed
    }

    // The audio is still taken after asking for it back.
    static async #offerRestart(): Promise<void> {
        if (this.#failureNotified) {return}
        this.#failureNotified = true
        const restart = this.restart
        const approved = await RuntimeNotifier.approve({
            headline: "Audio interrupted",
            message: "Another app is using the audio, or iOS cut it off. Try Play again in a moment. "
                + "If it stays silent, restart the audio: your work is saved first and comes back.",
            approveText: restart === null ? "OK" : "Restart audio",
            cancelText: "Not now"
        })
        this.#failureNotified = false
        if (approved && restart !== null) {await restart()}
    }

    // The rate the browser would pick on its own, to tell a device failure from our 48kHz request being refused.
    static async #probeHardwareSampleRate(): Promise<number> {
        const {status, value: context} = await Promises.tryCatch(Promise.resolve(new AudioContext()))
        if (status === "rejected") {return NaN}
        const {sampleRate} = context
        await Promises.tryCatch(context.close())
        return sampleRate
    }
}
