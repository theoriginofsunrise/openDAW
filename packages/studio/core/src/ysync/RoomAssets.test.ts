import {describe, expect, it} from "vitest"
import {Errors, UUID} from "@opendaw/lib-std"
import {AudioData, WavFile} from "@opendaw/lib-dsp"
import {firstOf, RoomAssets} from "./RoomAssets"

const uuid = UUID.parse("11111111-2222-3333-4444-555555555555")
const id = "11111111-2222-3333-4444-555555555555"
const meta = {name: "Take 1", bpm: 120, duration: 1, sample_rate: 48000, origin: "recording"}

const wav = (): ArrayBuffer => {
    const data = AudioData.create(48000, 100, 1)
    data.frames[0].fill(0.25)
    return WavFile.encodeInts16(data)
}

// A tiny server: the shared files in a map, answering only what the room assets ask.
const server = () => {
    const files = new Map<string, ArrayBuffer>()
    const calls: Array<string> = []
    const fetcher = (async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
        const url = new URL(String(input))
        calls.push(`${init.method ?? "GET"} ${url.pathname} ${(init.headers as Record<string, string>)?.Authorization ?? ""}`)
        const key = url.pathname
        if (init.method === "PUT") {
            files.set(key, init.body as ArrayBuffer)
            return new Response("{}", {status: 200})
        }
        const found = files.get(key)
        if (found === undefined) {return new Response("{}", {status: 404})}
        return init.method === "HEAD" ? new Response(null, {status: 200}) : new Response(found.slice(0), {status: 200})
    }) as typeof fetch
    return {files, calls, fetcher}
}
const noSleep = () => Promise.resolve()

describe("RoomAssets", () => {
    it("hands an audio file over: put in by one, taken out by the other", async () => {
        const {fetcher, files} = server()
        const sender = new RoomAssets("wss://echo.example/", "my room", () => "token-a", fetcher)
        const receiver = new RoomAssets("https://echo.example", "my room", () => "token-b", fetcher)
        await sender.upload(id, wav(), JSON.stringify(meta))
        expect([...files.keys()].sort()).toEqual([
            `/shared/rooms/my%20room/samples/${id}/audio.wav`, `/shared/rooms/my%20room/samples/${id}/meta.json`])
        const progress: Array<number> = []
        const [audio, description] = await receiver.fetchSample(uuid, value => progress.push(value))
        expect(description).toEqual(meta)
        expect(audio.numberOfFrames).toBe(100)
        expect(audio.frames[0][50]).toBeCloseTo(0.25, 3)
        expect(progress.length).toBeGreaterThan(0)
    })

    it("sends the login, and turns a socket address into a web address", async () => {
        const {fetcher, calls} = server()
        await new RoomAssets("wss://echo.example", "r", () => "secret", fetcher).exists(id)
        expect(calls[0]).toBe(`HEAD /shared/rooms/r/samples/${id}/meta.json Bearer secret`)
    })

    it("knows whether the file is there (the description is put last: found means complete)", async () => {
        const {fetcher} = server()
        const assets = new RoomAssets("https://echo.example", "r", () => "t", fetcher)
        expect(await assets.exists(id)).toBe(false)
        await assets.upload(id, wav(), "{}")
        expect(await assets.exists(id)).toBe(true)
    })

    it("waits for a file that is still being recorded", async () => {
        const {fetcher} = server()
        const sender = new RoomAssets("https://echo.example", "r", () => "t", fetcher)
        const receiver = new RoomAssets("https://echo.example", "r", () => "t", fetcher)
        let sleeps = 0
        const sleep = async () => {
            sleeps++
            if (sleeps === 3) {await sender.upload(id, wav(), JSON.stringify(meta))}
        }
        const [audio] = await receiver.fetchSample(uuid, () => {}, undefined, sleep)
        expect(sleeps).toBe(3)
        expect(audio.numberOfFrames).toBe(100)
    })

    it("gives up when it is told another way was quicker", async () => {
        const {fetcher} = server()
        const receiver = new RoomAssets("https://echo.example", "r", () => "t", fetcher)
        const controller = new AbortController()
        let sleeps = 0
        const sleep = async () => {
            if (++sleeps === 2) {controller.abort()}
        }
        await expect(receiver.fetchSample(uuid, () => {}, controller.signal, sleep)).rejects.toBe(Errors.AbortError)
        expect(sleeps).toBe(2)
    })

    it("gives up when nobody hands the file over in time", async () => {
        const {fetcher} = server()
        const receiver = new RoomAssets("https://echo.example", "r", () => "t", fetcher)
        await expect(receiver.fetchSample(uuid, () => {}, undefined, noSleep, 6000)).rejects.toBeInstanceOf(Errors.FileNotFound)
    })

    it("does not pretend a server error is a missing file", async () => {
        const broken = (async () => new Response("no", {status: 500})) as typeof fetch
        const assets = new RoomAssets("https://echo.example", "r", () => "t", broken)
        await expect(assets.fetchSample(uuid, () => {}, undefined, noSleep)).rejects.toThrow("500")
        await expect(assets.exists(id)).rejects.toThrow("500")
        await expect(assets.upload(id, wav(), "{}")).rejects.toThrow("500")
    })

    it("needs a login", async () => {
        const {fetcher} = server()
        const assets = new RoomAssets("https://echo.example", "r", () => null, fetcher)
        await expect(assets.exists(id)).rejects.toThrow("Not signed in")
    })
})

describe("firstOf", () => {
    it("takes the first one that delivers and tells the others to stop", async () => {
        const stopped: Array<boolean> = []
        const slow = (signal: AbortSignal) => new Promise<string>(resolve => {
            const timer = setTimeout(() => resolve("slow"), 200)
            signal.addEventListener("abort", () => {
                stopped.push(true)
                clearTimeout(timer)
            })
        })
        const quick = async () => "quick"
        expect(await firstOf([slow, quick])).toBe("quick")
        expect(stopped).toEqual([true])
    })

    it("does not mind a failure while another one still delivers", async () => {
        const failing = () => Promise.reject(new Error("no connection"))
        const late = () => new Promise<string>(resolve => setTimeout(() => resolve("late"), 20))
        expect(await firstOf([failing, late])).toBe("late")
    })

    it("fails only when every way failed, with the last reason", async () => {
        const failing = (message: string) => () => Promise.reject(new Error(message))
        await expect(firstOf([failing("one"), failing("two")])).rejects.toThrow(/one|two/)
        await expect(firstOf([])).rejects.toThrow("No way")
    })
})
