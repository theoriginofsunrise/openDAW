import {describe, expect, it} from "vitest"
import {informationText, offlineLine} from "./InformationText"

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

describe("offlineLine", () => {
    const build = "a682a6"
    const full = "a682a6ff-0000-1111-2222-333333333333"

    it("says nothing when the app did not ask", () => {
        expect(offlineLine(undefined, build)).toBeNull()
    })

    it("says there is none, when no service worker answers", () => {
        expect(offlineLine(null, build)).toContain("none")
    })

    it("tells how far the download is, and when it is complete", () => {
        expect(offlineLine({build: full, cached: 40, total: 300}, build)).toBe("Offline copy: coming in, 40 of 300 files")
        expect(offlineLine({build: full, cached: 300, total: 300}, build)).toBe("Offline copy: complete, 300 files")
        expect(offlineLine({build: full, cached: 12, total: 0}, build)).toBe("Offline copy: complete")
    })

    it("tells when the copy belongs to another build than the page that is open", () => {
        const line = offlineLine({build: "bbbbbbff-0000", cached: 300, total: 300}, build)
        expect(line).toContain("another build (bbbbbb)")
        expect(line).toContain("Reload")
    })

    it("goes into the Information text", () => {
        const text = informationText({
            online: true, project: null, sampleRate: 48000, outputLatency: 0, build, buildTime: Number.NaN,
            signedInAs: null, offline: {build: full, cached: 10, total: 20}
        })
        expect(text).toContain("Offline copy: coming in, 10 of 20 files")
    })
})
