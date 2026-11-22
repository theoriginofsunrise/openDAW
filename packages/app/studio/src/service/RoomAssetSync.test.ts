import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
import {RoomAssetSync, RoomAssetSyncDeps} from "./RoomAssetSync"

const setup = (overrides: Partial<RoomAssetSyncDeps> = {}) => {
    const ids: Array<string> = []
    const local = new Set<string>()
    const remote = new Set<string>()
    const uploads: Array<string> = []
    const warnings: Array<string> = []
    const deps: RoomAssetSyncDeps = {
        listIds: () => ids,
        hasLocal: async id => local.has(id),
        readLocal: async id => ({wav: new ArrayBuffer(4), meta: `{"id":"${id}"}`}),
        exists: async id => remote.has(id),
        upload: async id => {
            uploads.push(id)
            remote.add(id)
        },
        warn: message => warnings.push(message),
        ...overrides
    }
    return {ids, local, remote, uploads, warnings, deps}
}

describe("RoomAssetSync", () => {
    beforeEach(() => {vi.useFakeTimers()})
    afterEach(() => {vi.useRealTimers()})

    it("hands over a file that is on this device, once", async () => {
        const {ids, local, uploads, deps} = setup()
        ids.push("a")
        local.add("a")
        const sync = new RoomAssetSync(deps, 1000)
        await vi.advanceTimersByTimeAsync(5000)
        expect(uploads).toEqual(["a"])
        sync.terminate()
    })

    it("waits for a recording to be finished before handing it over", async () => {
        const {ids, local, uploads, deps} = setup()
        ids.push("take")
        const sync = new RoomAssetSync(deps, 1000)
        await vi.advanceTimersByTimeAsync(3500)
        expect(uploads).toEqual([])
        local.add("take")
        await vi.advanceTimersByTimeAsync(1100)
        expect(uploads).toEqual(["take"])
        sync.terminate()
    })

    it("does not hand over what the room already has", async () => {
        const {ids, local, remote, uploads, deps} = setup()
        ids.push("a")
        local.add("a")
        remote.add("a")
        const sync = new RoomAssetSync(deps, 1000)
        await vi.advanceTimersByTimeAsync(3000)
        expect(uploads).toEqual([])
        sync.terminate()
    })

    it("picks up a file that joins the project later", async () => {
        const {ids, local, uploads, deps} = setup()
        const sync = new RoomAssetSync(deps, 1000)
        await vi.advanceTimersByTimeAsync(1500)
        ids.push("late")
        local.add("late")
        await vi.advanceTimersByTimeAsync(1100)
        expect(uploads).toEqual(["late"])
        sync.terminate()
    })

    it("tries again after a failure, and stops after five", async () => {
        let attempts = 0
        const {ids, local, warnings, deps} = setup({
            upload: async () => {
                attempts++
                throw new Error("server down")
            }
        })
        ids.push("a")
        local.add("a")
        const sync = new RoomAssetSync(deps, 1000)
        await vi.advanceTimersByTimeAsync(20_000)
        expect(attempts).toBe(5)
        expect(warnings).toHaveLength(5)
        sync.terminate()
    })

    it("does one failing file at a time without holding up the others", async () => {
        const {ids, local, uploads, deps} = setup({
            upload: async id => {
                if (id === "bad") {throw new Error("too big")}
                uploads.push(id)
            }
        })
        ids.push("bad", "good")
        local.add("bad")
        local.add("good")
        const sync = new RoomAssetSync(deps, 1000)
        await vi.advanceTimersByTimeAsync(2500)
        expect(uploads).toEqual(["good"])
        sync.terminate()
    })

    it("stops when the room is left", async () => {
        const {ids, local, uploads, deps} = setup()
        const sync = new RoomAssetSync(deps, 1000)
        sync.terminate()
        ids.push("a")
        local.add("a")
        await vi.advanceTimersByTimeAsync(5000)
        expect(uploads).toEqual([])
    })
})
