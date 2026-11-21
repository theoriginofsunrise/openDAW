import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
import {Errors} from "@opendaw/lib-std"
import {EchoAutoSync, EchoSyncDeps, EchoSyncReason} from "./EchoAutoSync"
import {EchoSessionExpired} from "./EchoCloudHandler"
import {CloudHandler} from "./CloudHandler"

const handler = {} as CloudHandler

const setup = (overrides: Partial<EchoSyncDeps> = {}) => {
    let now = 1_000_000
    const runs: Array<EchoSyncReason> = []
    const notices: Array<string> = []
    let notes: Array<string> = []
    const deps: EchoSyncDeps = {
        enabled: true,
        peek: () => handler,
        login: () => Promise.resolve(handler),
        run: async (_handler, reason) => {runs.push(reason)},
        takeNotes: () => notes.splice(0, notes.length),
        notify: message => notices.push(message),
        now: () => now,
        ...overrides
    }
    const sync = new EchoAutoSync(deps)
    return {
        sync, runs, notices, setNotes: (lines: Array<string>) => {notes = lines},
        advance: async (ms: number) => {
            now += ms
            await vi.advanceTimersByTimeAsync(ms)
        }
    }
}

describe("EchoAutoSync", () => {
    beforeEach(() => {vi.useFakeTimers()})
    afterEach(() => {vi.useRealTimers()})

    it("does nothing at all when there is no storage server in this build", async () => {
        const {sync, runs} = setup({enabled: false})
        expect(sync.state.getValue()).toBe("off")
        sync.request("start")
        await sync.syncNow()
        await vi.advanceTimersByTimeAsync(10_000)
        expect(runs).toEqual([])
        expect(sync.state.getValue()).toBe("off")
    })

    it("stays quiet and opens no login window when not signed in", async () => {
        const login = vi.fn(() => Promise.resolve(handler))
        const {sync, runs} = setup({peek: () => null, login})
        sync.request("start")
        await vi.advanceTimersByTimeAsync(10)
        expect(runs).toEqual([])
        expect(login).not.toHaveBeenCalled()
        expect(sync.state.getValue()).toBe("signed-out")
    })

    it("syncs right away at the start when signed in", async () => {
        const {sync, runs} = setup()
        sync.request("start")
        await vi.advanceTimersByTimeAsync(10)
        expect(runs).toEqual(["start"])
        expect(sync.state.getValue()).toBe("idle")
    })

    it("waits a moment after a save and turns a series of saves into one sync", async () => {
        const {sync, runs} = setup()
        sync.request("save")
        await vi.advanceTimersByTimeAsync(EchoAutoSync.SaveDelay - 100)
        expect(runs).toEqual([])
        sync.request("save")
        sync.request("delete")
        await vi.advanceTimersByTimeAsync(200)
        expect(runs).toEqual(["save"])
        await vi.advanceTimersByTimeAsync(10_000)
        expect(runs).toEqual(["save"])
    })

    it("does not sync again at once when the app comes back to the front, but does after a while", async () => {
        const {sync, runs, advance} = setup()
        sync.request("start")
        await advance(10)
        sync.request("visible")
        await advance(30_000)
        expect(runs).toEqual(["start"])
        await advance(40_000)
        sync.request("visible")
        await advance(10)
        expect(runs).toEqual(["start", "visible"])
    })

    it("lets the timer wait longer than coming back to the front", async () => {
        const {sync, runs, advance} = setup()
        sync.request("start")
        await advance(10)
        await advance(100_000)
        sync.request("timer")
        await advance(10)
        expect(runs).toEqual(["start"])
        await advance(60_000)
        sync.request("timer")
        await advance(10)
        expect(runs).toEqual(["start", "timer"])
    })

    it("tells the person what the sync did", async () => {
        const {sync, notices, setNotes} = setup()
        setNotes(["'Song' was updated from the cloud.", "'Beat' was kept."])
        await sync.syncNow()
        expect(notices).toEqual(["'Song' was updated from the cloud.\n'Beat' was kept."])
    })

    it("logs in when the person asks for a sync, then syncs", async () => {
        let loggedIn = false
        const {sync, runs} = setup({
            peek: () => loggedIn ? handler : null,
            login: async () => {
                loggedIn = true
                return handler
            }
        })
        await sync.syncNow()
        expect(loggedIn).toBe(true)
        expect(runs).toEqual(["manual"])
        expect(sync.state.getValue()).toBe("idle")
    })

    it("treats a closed login window as no problem", async () => {
        const {sync, runs} = setup({peek: () => null, login: () => Promise.reject("cancelled")})
        await expect(sync.syncNow()).resolves.toBeUndefined()
        expect(runs).toEqual([])
        expect(sync.state.getValue()).toBe("signed-out")
        const closed = setup({peek: () => null, login: () => Promise.reject(null)})
        await expect(closed.sync.syncNow()).resolves.toBeUndefined()
    })

    it("reports a refused login (an email that is not allowed) to the person who asked", async () => {
        const {sync, runs} = setup({
            peek: () => null,
            login: () => Promise.reject(new Error("someone@example.com is not allowed on this server."))
        })
        await expect(sync.syncNow()).rejects.toThrow("not allowed")
        expect(runs).toEqual([])
        expect(sync.state.getValue()).toBe("signed-out")
    })

    it("goes back to signed out, silently, when the login ended", async () => {
        const {sync, notices} = setup({run: () => Promise.reject(new EchoSessionExpired())})
        sync.request("start")
        await vi.advanceTimersByTimeAsync(10)
        expect(sync.state.getValue()).toBe("signed-out")
        expect(notices).toEqual([])
    })

    it("shows a failed background sync once, not every time", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
        const {sync, notices, advance} = setup({run: () => Promise.reject(new Error("network down"))})
        sync.request("start")
        await advance(10)
        expect(sync.state.getValue()).toBe("error")
        expect(notices).toHaveLength(1)
        expect(notices[0]).toContain("network down")
        sync.request("save")
        await advance(EchoAutoSync.SaveDelay + 10)
        expect(notices).toHaveLength(1)
        await advance(EchoAutoSync.ErrorNoticeGap)
        sync.request("save")
        await advance(EchoAutoSync.SaveDelay + 10)
        expect(notices).toHaveLength(2)
        warn.mockRestore()
    })

    it("reports a failed sync to the person who asked for it", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
        const {sync, notices} = setup({run: () => Promise.reject(new Error("disk full"))})
        await expect(sync.syncNow()).rejects.toThrow("disk full")
        expect(sync.state.getValue()).toBe("error")
        expect(notices).toEqual([])
        warn.mockRestore()
    })

    it("treats an aborted sync as nothing to worry about", async () => {
        const {sync, notices} = setup({run: () => Promise.reject(Errors.AbortError)})
        await sync.syncNow()
        expect(sync.state.getValue()).toBe("idle")
        expect(notices).toEqual([])
    })

    it("never runs two syncs at the same time", async () => {
        let active = 0
        let most = 0
        const {sync, runs} = setup({
            run: async (_handler, reason) => {
                active++
                most = Math.max(most, active)
                await new Promise(resolve => setTimeout(resolve, 100))
                active--
                runs.push(reason)
            }
        })
        const first = sync.syncNow()
        const second = sync.syncNow()
        sync.request("start")
        await vi.advanceTimersByTimeAsync(1000)
        await Promise.all([first, second])
        expect(most).toBe(1)
        expect(runs.length).toBe(3)
    })

    it("shows the state while syncing", async () => {
        const seen: Array<string> = []
        const {sync} = setup({run: async () => {await new Promise(resolve => setTimeout(resolve, 50))}})
        sync.state.subscribe(owner => seen.push(owner.getValue()))
        const done = sync.syncNow()
        await vi.advanceTimersByTimeAsync(100)
        await done
        expect(seen).toEqual(["syncing", "idle"])
    })
})
