import {afterEach, beforeEach, describe, expect, it} from "vitest"
import {AudioData, WavFile} from "@opendaw/lib-dsp"
import {SampleFormat} from "./SampleFormat"

const store = new Map<string, string>()

const audio = (frames: number, channels: number = 2): AudioData => {
    const data = AudioData.create(48000, frames, channels)
    for (let channel = 0; channel < channels; channel++) {
        for (let index = 0; index < frames; index++) {
            data.frames[channel][index] = Math.sin((index + channel * 7) / 20) * 0.8
        }
    }
    return data
}

describe("SampleFormat", () => {
    beforeEach(() => {
        store.clear()
        ;(globalThis as { localStorage?: unknown }).localStorage = {
            getItem: (key: string) => store.get(key) ?? null,
            setItem: (key: string, value: string) => void store.set(key, value),
            removeItem: (key: string) => void store.delete(key)
        }
    })
    afterEach(() => {delete (globalThis as { localStorage?: unknown }).localStorage})

    it("stores 16-bit by default", () => {
        expect(SampleFormat.DefaultKind).toBe("pcm16")
        expect(SampleFormat.get()).toBe("pcm16")
        const bytes = SampleFormat.encode(audio(1000))
        const view = new DataView(bytes)
        expect(view.getUint16(20, true)).toBe(1)  // PCM
        expect(view.getUint16(34, true)).toBe(16) // bits per sample
    })

    it("takes half the room of the float format, and three quarters for 24-bit", () => {
        const source = audio(48000)
        const float = SampleFormat.encode(source, "float32").byteLength
        expect(SampleFormat.encode(source, "pcm16").byteLength / float).toBeCloseTo(0.5, 2)
        expect(SampleFormat.encode(source, "pcm24").byteLength / float).toBeCloseTo(0.75, 2)
    })

    it("reads back what it wrote, within the precision of the format", () => {
        const source = audio(2000)
        // the writer scales by 32767 and the reader divides by 32768: a gain error of 0.003%, far below hearing
        for (const [kind, tolerance] of [["pcm16", 2 / 32767], ["pcm24", 2 / 8388607], ["float32", 0]] as const) {
            const decoded = WavFile.decodeFloats(SampleFormat.encode(source, kind))
            expect(decoded.numberOfFrames).toBe(2000)
            expect(decoded.sampleRate).toBe(48000)
            expect(decoded.frames.length).toBe(2)
            for (let channel = 0; channel < 2; channel++) {
                for (let i = 0; i < 2000; i += 37) {
                    expect(Math.abs(decoded.frames[channel][i] - source.frames[channel][i])).toBeLessThanOrEqual(tolerance)
                }
            }
        }
    })

    it("keeps mono mono", () => {
        const decoded = WavFile.decodeFloats(SampleFormat.encode(audio(500, 1)))
        expect(decoded.frames.length).toBe(1)
    })

    it("cuts levels above full scale instead of wrapping around", () => {
        const loud = AudioData.create(48000, 3, 1)
        loud.frames[0].set([1.5, -1.5, 0.5])
        const decoded = WavFile.decodeFloats(SampleFormat.encode(loud, "pcm16"))
        expect(decoded.frames[0][0]).toBeCloseTo(1, 3)
        expect(decoded.frames[0][1]).toBeCloseTo(-1, 3)
        expect(decoded.frames[0][2]).toBeCloseTo(0.5, 3)
    })

    it("can be switched, and ignores nonsense", () => {
        SampleFormat.set("float32")
        expect(SampleFormat.get()).toBe("float32")
        expect(new DataView(SampleFormat.encode(audio(10))).getUint16(34, true)).toBe(32)
        store.set("opendaw-sample-format", "mp3")
        expect(SampleFormat.get()).toBe("pcm16")
    })

    it("falls back to 16-bit when the browser has no storage", () => {
        delete (globalThis as { localStorage?: unknown }).localStorage
        expect(SampleFormat.get()).toBe("pcm16")
        expect(() => SampleFormat.set("pcm24")).not.toThrow()
    })
})
