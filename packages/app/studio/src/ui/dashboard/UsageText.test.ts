import {describe, expect, it} from "vitest"
import type {EchoUsage} from "@opendaw/studio-core"
import {detailsText, formatBytes, fractionUsed, levelOf, summaryText} from "./UsageText"

const usage = (overrides: Partial<EchoUsage> = {}): EchoUsage => ({
    freeBytes: 10_000_000_000,
    total: {bytes: 1_234_000_000, objects: 42},
    kinds: {
        projects: {bytes: 2_000_000, objects: 8}, samples: {bytes: 1_200_000_000, objects: 30},
        rooms: {bytes: 30_000_000, objects: 3}, other: {bytes: 2_000, objects: 1}
    },
    mine: {bytes: 1_000_000_000, objects: 35},
    largest: [{path: "samples/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.wav", bytes: 400_000_000}, {path: "projects/index.json", bytes: 2_000}],
    at: 0, ...overrides
})

describe("formatBytes", () => {
    it("uses the unit that fits, a billion bytes to the gigabyte", () => {
        expect(formatBytes(0)).toBe("0 B")
        expect(formatBytes(999)).toBe("999 B")
        expect(formatBytes(1_500)).toBe("1.5 kB")
        expect(formatBytes(48_000)).toBe("48 kB")
        expect(formatBytes(2_500_000)).toBe("2.5 MB")
        expect(formatBytes(150_000_000)).toBe("150 MB")
        expect(formatBytes(1_234_000_000)).toBe("1.23 GB")
        expect(formatBytes(10_000_000_000)).toBe("10.00 GB")
    })
})

describe("level", () => {
    it("is green, orange, red", () => {
        expect(levelOf(0)).toBe("ok")
        expect(levelOf(0.69)).toBe("ok")
        expect(levelOf(0.7)).toBe("warn")
        expect(levelOf(0.89)).toBe("warn")
        expect(levelOf(0.9)).toBe("full")
        expect(levelOf(1.4)).toBe("full")
    })

    it("compares with what is free, and does not divide by nothing", () => {
        expect(fractionUsed(5_000_000_000, 10_000_000_000)).toBe(0.5)
        expect(fractionUsed(1, 0)).toBe(1)
        expect(fractionUsed(-5, 10)).toBe(0)
    })
})

describe("text", () => {
    it("sums up in one line", () => {
        expect(summaryText(usage())).toBe("1.23 GB of 10.00 GB (12%)")
    })

    it("says where the space goes", () => {
        const text = detailsText(usage())
        expect(text).toContain("Audio: 1.23 GB".replace("1.23", "1.20"))
        expect(text).toContain("Projects: 2.0 MB in 8 files")
        expect(text).toContain("Live room transfers (deleted after a day): 30 MB in 3 files")
        expect(text).toContain("Other (notes, lists): 2.0 kB in 1 file")
        expect(text).toContain("Your own folder: 1.00 GB in 35 files")
    })

    it("names the biggest audio files when the list of samples knows them", () => {
        const text = detailsText(usage(), {"aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee": "Guitar take 3"})
        expect(text).toContain("400 MB  Guitar take 3 (samples)")
        expect(text).toContain("2.0 kB  projects/index.json")
        const unnamed = detailsText(usage())
        expect(unnamed).toContain("400 MB  samples/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.wav")
    })

    it("has no list of big files for an empty cloud", () => {
        const text = detailsText(usage({largest: [], total: {bytes: 0, objects: 0}}))
        expect(text).not.toContain("Biggest files")
        expect(text.startsWith("0 B of 10.00 GB (0%)")).toBe(true)
    })
})
