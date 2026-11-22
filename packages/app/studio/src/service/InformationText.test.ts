import {describe, expect, it} from "vitest"
import {informationText} from "./InformationText"

const base = {
    online: true, project: "My Song", sampleRate: 48000, outputLatency: 0.0179, build: "a682a6",
    buildTime: Date.UTC(2026, 10, 21, 22, 15), signedInAs: "me@example.com"
}

describe("informationText", () => {
    it("lists what the status line shows", () => {
        expect(informationText(base)).toBe([
            "Online: yes",
            "Project: My Song",
            "Sample rate: 48 kHz",
            "Output latency: 17.9 ms",
            "Build: a682a6 (2026-11-21 22:15 UTC)",
            "Storage server: signed in as me@example.com"
        ].join("\n"))
    })

    it("says so when nothing is open, nothing is known, or nobody is signed in", () => {
        const text = informationText({...base, online: false, project: null, outputLatency: 0, signedInAs: ""})
        expect(text).toContain("Online: no")
        expect(text).toContain("Project: none open")
        expect(text).toContain("Output latency: not known yet")
        expect(text).toContain("Storage server: not signed in")
    })

    it("leaves out the storage server when the build has none, and the time when it is not known", () => {
        const text = informationText({...base, signedInAs: null, buildTime: Number.NaN})
        expect(text).not.toContain("Storage server")
        expect(text).toContain("Build: a682a6\n".trim())
        expect(text).not.toContain("UTC")
    })

    it("shows a rate that is not a whole number of kilohertz", () => {
        expect(informationText({...base, sampleRate: 44100})).toContain("Sample rate: 44.1 kHz")
    })
})
