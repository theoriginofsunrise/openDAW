import {beforeAll, describe, expect, it} from "vitest"
import {Errors} from "@opendaw/lib-std"
import {CloudHandler} from "./CloudHandler"
import {CloudPresence, PresenceNote} from "./CloudPresence"

const UUID = "11111111-2222-3333-4444-555555555555" as never

const stubStorage = () => {
    const values = new Map<string, string>()
    ;(globalThis as unknown as { localStorage: Storage }).localStorage = {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => {values.set(key, value)},
        removeItem: (key: string) => {values.delete(key)},
        clear: () => values.clear(),
        key: () => null,
        length: 0
    } as Storage
}

// a cloud that lives in memory
const memoryCloud = (): CloudHandler & { files: Map<string, string> } => {
    const files = new Map<string, string>()
    const encode = (text: string) => new TextEncoder().encode(text).buffer as ArrayBuffer
    return {
        files,
        upload: async (path, data) => {files.set(path, new TextDecoder().decode(data))},
        exists: async path => files.has(path),
        download: async path => {
            const text = files.get(path)
            if (text === undefined) {throw new Errors.FileNotFound(path)}
            return encode(text)
        },
        list: async (path = "") => {
            const names = [...files.keys()].filter(key => key.startsWith(`${path}/`)).map(key => key.slice(path.length + 1))
            if (names.length === 0) {throw new Errors.FileNotFound(path)}
            return names
        },
        delete: async path => {files.delete(path)},
        alive: async () => {}
    }
}

const note = (session: string, seenSecondsAgo: number): PresenceNote => ({
    device: "iPhone", session, project: "Song", since: new Date(Date.now() - 600_000).toISOString(),
    seen: new Date(Date.now() - seenSecondsAgo * 1000).toISOString()
})

describe("CloudPresence", () => {
    beforeAll(stubStorage)

    it("finds no one when nobody has the project open", async () => {
        expect(await CloudPresence.others(memoryCloud(), UUID)).toEqual([])
    })

    it("sees another device that renewed its note recently", async () => {
        const cloud = memoryCloud()
        cloud.files.set(`presence/${UUID}/other-device.json`, JSON.stringify(note("other-device", 30)))
        const found = await CloudPresence.others(cloud, UUID)
        expect(found.map(entry => entry.session)).toEqual(["other-device"])
    })

    it("ignores a note that was not renewed for a while", async () => {
        const cloud = memoryCloud()
        cloud.files.set(`presence/${UUID}/gone.json`, JSON.stringify(note("gone", 600)))
        expect(await CloudPresence.others(cloud, UUID)).toEqual([])
    })

    it("never reports this device's own note", async () => {
        const cloud = memoryCloud()
        await CloudPresence.renew(cloud, UUID, "Song", new Date().toISOString())
        expect(cloud.files.size).toBe(1)
        expect(await CloudPresence.others(cloud, UUID)).toEqual([])
    })

    it("removes this device's note when asked", async () => {
        const cloud = memoryCloud()
        await CloudPresence.renew(cloud, UUID, "Song", new Date().toISOString())
        await CloudPresence.clear(cloud, UUID)
        expect(cloud.files.size).toBe(0)
    })

    it("cleans up notes that are more than a day old, and skips unreadable ones", async () => {
        const cloud = memoryCloud()
        cloud.files.set(`presence/${UUID}/ancient.json`, JSON.stringify(note("ancient", 2 * 24 * 3600)))
        cloud.files.set(`presence/${UUID}/broken.json`, "{not json")
        expect(await CloudPresence.others(cloud, UUID)).toEqual([])
        expect(cloud.files.has(`presence/${UUID}/ancient.json`)).toBe(false)
    })

    it("names the device after what it is", () => {
        expect(CloudPresence.deviceName().length).toBeGreaterThan(0)
    })
})
