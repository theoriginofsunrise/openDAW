import {beforeEach, describe, expect, it} from "vitest"
import {CloudAuthManager} from "./CloudAuthManager"

const KEY = "opendaw-cloud-token:GoogleDrive"
const values = new Map<string, string>()

const manager = () => CloudAuthManager.create({Dropbox: "d", GoogleDrive: "g"})

describe("CloudAuthManager remembers the Google login", () => {
    beforeEach(() => {
        values.clear()
        ;(globalThis as unknown as { localStorage: Storage }).localStorage = {
            getItem: (key: string) => values.get(key) ?? null,
            setItem: (key: string, value: string) => {values.set(key, value)},
            removeItem: (key: string) => {values.delete(key)},
            clear: () => values.clear(),
            key: () => null,
            length: 0
        } as Storage
    })

    it("has no handler when nobody logged in", () => {
        expect(manager().peekHandler()).toBeNull()
    })

    it("offers a handler for a login that is still good, even in a new session", () => {
        values.set(KEY, JSON.stringify({token: "abc", until: Date.now() + 10 * 60_000}))
        expect(manager().peekHandler()).not.toBeNull()
    })

    it("does not offer a login that has run out", () => {
        values.set(KEY, JSON.stringify({token: "abc", until: Date.now() - 1000}))
        expect(manager().peekHandler()).toBeNull()
    })

    it("does not trust damaged storage", () => {
        values.set(KEY, "{not json")
        expect(manager().peekHandler()).toBeNull()
        values.set(KEY, JSON.stringify({token: 5, until: "later"}))
        expect(manager().peekHandler()).toBeNull()
    })
})
