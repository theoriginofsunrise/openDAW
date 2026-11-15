import {describe, expect, it} from "vitest"
import {Errors} from "@opendaw/lib-std"
import {CloudHandler} from "./CloudHandler"
import {CloudBackupTombstones} from "./CloudBackupTombstones"

const A = "aaaaaaaa-0000-0000-0000-000000000001" as never
const B = "bbbbbbbb-0000-0000-0000-000000000002" as never
const C = "cccccccc-0000-0000-0000-000000000003" as never

const memoryCloud = (): CloudHandler & { files: Map<string, string>, uploads: number } => {
    const files = new Map<string, string>()
    const cloud = {
        files,
        uploads: 0,
        upload: async (path: string, data: ArrayBuffer) => {
            cloud.uploads++
            files.set(path, new TextDecoder().decode(data))
        },
        exists: async (path: string) => files.has(path),
        download: async (path: string) => {
            const text = files.get(path)
            if (text === undefined) {throw new Errors.FileNotFound(path)}
            return new TextEncoder().encode(text).buffer as ArrayBuffer
        },
        list: async () => [],
        delete: async (path: string) => {files.delete(path)},
        alive: async () => {}
    }
    return cloud
}

describe("CloudBackupTombstones", () => {
    it("reads nothing when no deletion was ever recorded", async () => {
        expect(await CloudBackupTombstones.read(memoryCloud(), "projects")).toEqual([])
    })

    it("collects the deletions of every device and only ever grows", async () => {
        const cloud = memoryCloud()
        expect(await CloudBackupTombstones.sync(cloud, "projects", [A], () => {})).toEqual([A])
        expect(await CloudBackupTombstones.sync(cloud, "projects", [B], () => {})).toEqual([A, B])
        expect(await CloudBackupTombstones.read(cloud, "projects")).toEqual([A, B])
    })

    it("takes a cancelled deletion back out, for every device", async () => {
        const cloud = memoryCloud()
        await CloudBackupTombstones.sync(cloud, "projects", [A, B, C], () => {})
        await CloudBackupTombstones.forget(cloud, "projects", [B])
        expect(await CloudBackupTombstones.read(cloud, "projects")).toEqual([A, C])
    })

    it("does not write when there is nothing to forget", async () => {
        const cloud = memoryCloud()
        await CloudBackupTombstones.sync(cloud, "projects", [A], () => {})
        const before = cloud.uploads
        await CloudBackupTombstones.forget(cloud, "projects", [B])
        expect(cloud.uploads).toBe(before)
    })

    it("keeps the lists of different folders apart", async () => {
        const cloud = memoryCloud()
        await CloudBackupTombstones.sync(cloud, "samples", [A], () => {})
        expect(await CloudBackupTombstones.read(cloud, "projects")).toEqual([])
    })
})
