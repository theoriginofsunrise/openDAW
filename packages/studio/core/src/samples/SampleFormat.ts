import {AudioData, WavFile} from "@opendaw/lib-dsp"

// Phone fork: how audio is written to the storage of this device and to the cloud. 16-bit is half the size of the
// 32-bit float the app used before, and is what a microphone or an audio interface delivers anyway. Audio that is
// already stored keeps whatever format it has, the player reads all of them.
export namespace SampleFormat {
    export type Kind = "float32" | "pcm24" | "pcm16"

    export const DefaultKind: Kind = "pcm16"

    const Key = "opendaw-sample-format"

    // Changeable in the browser console for now: localStorage.setItem("opendaw-sample-format", "pcm24")
    export const get = (): Kind => {
        try {
            const stored = localStorage.getItem(Key)
            if (stored === "float32" || stored === "pcm24" || stored === "pcm16") {return stored}
        } catch (_error) {/* storage not available */}
        return DefaultKind
    }

    export const set = (kind: Kind): void => {
        try {localStorage.setItem(Key, kind)} catch (_error) {/* not remembered */}
    }

    type Source = Parameters<typeof WavFile.encodeFloats>[0]

    export const encode = (audio: Source | AudioData, kind: Kind = get()): ArrayBuffer => {
        switch (kind) {
            case "float32":
                return WavFile.encodeFloats(audio)
            case "pcm24":
                return WavFile.encodeInts24(audio)
            case "pcm16":
                return WavFile.encodeInts16(audio)
        }
    }
}
