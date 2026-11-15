import {describe, expect, it} from "vitest"
import {CloudSyncBase} from "./CloudSyncBase"

const T1 = "2026-11-15T10:00:00.000Z"
const T2 = "2026-11-15T11:00:00.000Z"
const T3 = "2026-11-15T12:00:00.000Z"

describe("CloudSyncBase.verdict", () => {
    it("leaves identical copies alone, whatever the history", () => {
        expect(CloudSyncBase.verdict(T1, T1, T1)).toBe("same")
        expect(CloudSyncBase.verdict(T1, T1, undefined)).toBe("same")
        expect(CloudSyncBase.verdict(T2, T2, T1)).toBe("same")
    })

    it("uploads what only this device changed", () => {
        // synced at T1, saved again here at T2, the cloud still has T1
        expect(CloudSyncBase.verdict(T2, T1, T1)).toBe("upload")
    })

    it("downloads what only somebody else changed", () => {
        // synced at T1, this device did not touch it, the cloud now has T2
        expect(CloudSyncBase.verdict(T1, T2, T1)).toBe("download")
    })

    it("asks when both sides changed", () => {
        // synced at T1, saved here at T2, saved elsewhere at T3
        expect(CloudSyncBase.verdict(T2, T3, T1)).toBe("both-changed")
    })

    it("asks when there is no history, instead of guessing from the clocks", () => {
        // a newer local stamp could still hide a newer change elsewhere
        expect(CloudSyncBase.verdict(T3, T1, undefined)).toBe("unknown-history")
        expect(CloudSyncBase.verdict(T1, T3, undefined)).toBe("unknown-history")
    })

    it("does not trust the clocks of the devices: only equality counts", () => {
        // this device's clock runs ahead: its stamp is "newer" than the cloud's, but it never changed anything
        expect(CloudSyncBase.verdict(T1, T3, T1)).toBe("download")
        expect(CloudSyncBase.verdict(T3, T2, T2)).toBe("upload")
    })
})

describe("CloudSyncBase storage", () => {
    it("does not break where there is no storage", () => {
        expect(CloudSyncBase.load("GoogleDrive")).toEqual({})
        expect(() => CloudSyncBase.set("GoogleDrive", "abc" as never, T1)).not.toThrow()
    })
})
