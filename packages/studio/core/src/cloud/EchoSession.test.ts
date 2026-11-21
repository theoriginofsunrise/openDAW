import {afterEach, beforeEach, describe, expect, it} from "vitest"
import {EchoSession} from "./EchoSession"

const store = new Map<string, string>()

describe("EchoSession", () => {
    beforeEach(() => {
        store.clear()
        ;(globalThis as { localStorage?: unknown }).localStorage = {
            getItem: (key: string) => store.get(key) ?? null,
            setItem: (key: string, value: string) => void store.set(key, value),
            removeItem: (key: string) => void store.delete(key)
        }
    })
    afterEach(() => {delete (globalThis as { localStorage?: unknown }).localStorage})

    const now = 1_700_000_000_000

    it("remembers a login", () => {
        EchoSession.write({token: "t", email: "me@example.com", expiresAt: now / 1000 + 3600})
        expect(EchoSession.read(now)).toEqual({token: "t", email: "me@example.com", expiresAt: now / 1000 + 3600})
    })

    it("forgets a login that is over, or about to be", () => {
        EchoSession.write({token: "t", email: "me@example.com", expiresAt: now / 1000 - 1})
        expect(EchoSession.read(now)).toBeNull()
        EchoSession.write({token: "t", email: "me@example.com", expiresAt: now / 1000 + 30})
        expect(EchoSession.read(now)).toBeNull()
    })

    it("has nothing when nothing was stored, or what is stored is not a login", () => {
        expect(EchoSession.read(now)).toBeNull()
        store.set("opendaw-echo-session", "not json")
        expect(EchoSession.read(now)).toBeNull()
        store.set("opendaw-echo-session", JSON.stringify({token: 1}))
        expect(EchoSession.read(now)).toBeNull()
    })

    it("clears", () => {
        EchoSession.write({token: "t", email: "me@example.com", expiresAt: now / 1000 + 3600})
        EchoSession.clear()
        expect(EchoSession.read(now)).toBeNull()
    })

    it("does not break when the browser has no storage", () => {
        delete (globalThis as { localStorage?: unknown }).localStorage
        expect(() => EchoSession.write({token: "t", email: "e", expiresAt: 1})).not.toThrow()
        expect(EchoSession.read(now)).toBeNull()
        expect(() => EchoSession.clear()).not.toThrow()
    })
})
