import {afterEach, describe, expect, it} from "vitest"
import {RoomServer} from "./RoomServer"

describe("RoomServer", () => {
    afterEach(() => RoomServer.reset())

    it("uses the openDAW rooms when there is no server of our own", () => {
        expect(RoomServer.ours()).toBe(false)
        expect(RoomServer.url()).toBe("wss://live.opendaw.studio")
        expect(RoomServer.token()).toBeNull()
        expect(RoomServer.authorize("wss://live.opendaw.studio/signaling")).toBe("wss://live.opendaw.studio/signaling")
    })

    it("turns the web address of our server into a socket address", () => {
        RoomServer.configure("https://echostudio-server.echostudio.workers.dev/", () => "t")
        expect(RoomServer.ours()).toBe(true)
        expect(RoomServer.url()).toBe("wss://echostudio-server.echostudio.workers.dev")
        RoomServer.configure("http://localhost:8787", () => "t")
        expect(RoomServer.url()).toBe("ws://localhost:8787")
    })

    it("adds the login to addresses of our server only", () => {
        RoomServer.configure("https://echo.example", () => "a b/c")
        expect(RoomServer.authorize("wss://echo.example/signaling")).toBe("wss://echo.example/signaling?token=a%20b%2Fc")
        expect(RoomServer.authorize("wss://echo.example/signaling?x=1")).toBe("wss://echo.example/signaling?x=1&token=a%20b%2Fc")
        expect(RoomServer.authorize("wss://other.example/signaling")).toBe("wss://other.example/signaling")
    })

    it("leaves the address alone while nobody is signed in", () => {
        RoomServer.configure("https://echo.example", () => null)
        expect(RoomServer.authorize("wss://echo.example/signaling")).toBe("wss://echo.example/signaling")
        expect(RoomServer.token()).toBeNull()
    })

    it("asks for the login anew every time, so a fresh sign-in is picked up", () => {
        let login: string | null = null
        RoomServer.configure("https://echo.example", () => login)
        expect(RoomServer.token()).toBeNull()
        login = "fresh"
        expect(RoomServer.token()).toBe("fresh")
    })
})
