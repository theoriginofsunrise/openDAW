import {describe, expect, it} from "vitest"
import {CloudSyncStatus} from "./CloudSyncStatus"

const A = "aaaaaaaa-0000-0000-0000-000000000001" as never
const B = "bbbbbbbb-0000-0000-0000-000000000002" as never
const C = "cccccccc-0000-0000-0000-000000000003" as never
const T1 = "2026-11-15T10:00:00.000Z"
const T2 = "2026-11-15T11:00:00.000Z"
const T3 = "2026-11-15T12:00:00.000Z"

const status = (inputs: Partial<CloudSyncStatus.Inputs>) => CloudSyncStatus.compute({
    local: {}, cloud: {}, trashed: [], tombstones: [], bases: {}, ...inputs
})

describe("CloudSyncStatus.compute", () => {
    it("is clean when both sides hold the same projects", () => {
        const result = status({local: {[A]: {modified: T1}}, cloud: {[A]: {modified: T1}}, bases: {[A]: T1}})
        expect(result.count).toBe(0)
    })

    it("is clean with nothing anywhere", () => {
        expect(status({}).count).toBe(0)
    })

    it("counts a project only this device has as something to push", () => {
        expect(status({local: {[A]: {modified: T1}}}).push).toEqual([A])
    })

    it("counts a project only the cloud has as something to pull", () => {
        expect(status({cloud: {[A]: {modified: T1}}}).pull).toEqual([A])
    })

    it("pushes a project changed here and pulls one changed in the cloud", () => {
        const result = status({
            local: {[A]: {modified: T2}, [B]: {modified: T1}},
            cloud: {[A]: {modified: T1}, [B]: {modified: T2}},
            bases: {[A]: T1, [B]: T1}
        })
        expect(result.push).toEqual([A])
        expect(result.pull).toEqual([B])
    })

    it("asks about a project changed on both sides, or with no history", () => {
        const result = status({
            local: {[A]: {modified: T2}, [B]: {modified: T2}},
            cloud: {[A]: {modified: T3}, [B]: {modified: T3}},
            bases: {[A]: T1}
        })
        expect(result.decide).toEqual([A, B])
    })

    it("does not pull a project that was deleted for good", () => {
        expect(status({cloud: {[A]: {modified: T1}}, tombstones: [A]}).count).toBe(0)
    })

    it("flags a project deleted on another device that is still stored here", () => {
        expect(status({local: {[A]: {modified: T1}}, tombstones: [A]}).deletions).toEqual([A])
    })

    it("flags a project deleted here that the cloud still has", () => {
        expect(status({cloud: {[A]: {modified: T1}}, trashed: [A]}).deletions).toEqual([A])
    })

    it("flags a deletion that has not been recorded for the other devices yet, then settles", () => {
        expect(status({trashed: [A]}).deletions).toEqual([A])
        expect(status({trashed: [A], tombstones: [A]}).count).toBe(0)
    })

    it("adds everything up", () => {
        const result = status({
            local: {[A]: {modified: T2}, [C]: {modified: T1}},
            cloud: {[A]: {modified: T1}, [B]: {modified: T1}},
            bases: {[A]: T1}
        })
        expect(result.count).toBe(3) // A goes up, C goes up, B comes down
    })
})
