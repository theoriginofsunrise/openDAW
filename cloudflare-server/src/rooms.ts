import * as Y from "yjs"
import * as syncProtocol from "y-protocols/sync"
import * as awarenessProtocol from "y-protocols/awareness"
import * as encoding from "lib0/encoding"
import * as decoding from "lib0/decoding"
import {Env} from "./types"

const messageSync = 0
const messageAwareness = 1

type AwarenessChange = { added: Array<number>, updated: Array<number>, removed: Array<number> }

/**
 * One live room: the shared project (a Yjs document) and the people connected to it. The same protocol the app's
 * y-websocket client speaks (the sync and awareness messages), what packages/server/yjs-server does on its own machine.
 * The room lives as long as someone is connected, plus the moments Cloudflare keeps an idle object around: when
 * everybody leaves, the project is gone, each person has their own copy. Rooms are not stored.
 */
export class Room {
    readonly #doc = new Y.Doc({gc: true})
    readonly #awareness = new awarenessProtocol.Awareness(this.#doc)
    readonly #conns = new Set<WebSocket>()
    // who announced which presence (name, cursor): it goes away with them. The app's client sends every presence it
    // learns of back to the room, so "who sent the last update" says nothing: the first to announce an id owns it, and
    // only its owner can take it away.
    readonly #owner = new Map<number, WebSocket>()

    constructor(_state: unknown, _env: Env) {
        this.#awareness.setLocalState(null)
        this.#awareness.on("update", ({added, updated, removed}: AwarenessChange, origin: unknown) => {
            if (origin !== null && origin !== undefined && this.#conns.has(origin as WebSocket)) {
                const from = origin as WebSocket
                added.forEach(id => {if (!this.#owner.has(id)) {this.#owner.set(id, from)}})
                updated.forEach(id => {if (!this.#owner.has(id)) {this.#owner.set(id, from)}})
                removed.forEach(id => {if (this.#owner.get(id) === from) {this.#owner.delete(id)}})
            } else if (origin === null || origin === undefined) {
                removed.forEach(id => this.#owner.delete(id))
            }
            const encoder = encoding.createEncoder()
            encoding.writeVarUint(encoder, messageAwareness)
            encoding.writeVarUint8Array(encoder,
                awarenessProtocol.encodeAwarenessUpdate(this.#awareness, added.concat(updated, removed)))
            this.#broadcast(encoding.toUint8Array(encoder))
        })
        this.#doc.on("update", (update: Uint8Array) => {
            const encoder = encoding.createEncoder()
            encoding.writeVarUint(encoder, messageSync)
            syncProtocol.writeUpdate(encoder, update)
            this.#broadcast(encoding.toUint8Array(encoder))
        })
    }

    async fetch(request: Request): Promise<Response> {
        if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
            return new Response("Expected a WebSocket", {status: 426})
        }
        const pair = new WebSocketPair()
        const client = pair[0]
        const server = pair[1]
        server.accept()
        this.#attach(server)
        return new Response(null, {status: 101, webSocket: client})
    }

    #attach(socket: WebSocket): void {
        this.#conns.add(socket)
        socket.addEventListener("message", event => {
            if (typeof event.data === "string") {return}
            this.#receive(socket, new Uint8Array(event.data as ArrayBuffer))
        })
        socket.addEventListener("close", () => this.#close(socket))
        socket.addEventListener("error", () => this.#close(socket))
        // the first message of the conversation: what this room already has
        const encoder = encoding.createEncoder()
        encoding.writeVarUint(encoder, messageSync)
        syncProtocol.writeSyncStep1(encoder, this.#doc)
        this.#send(socket, encoding.toUint8Array(encoder))
        const states = this.#awareness.getStates()
        if (states.size > 0) {
            const awarenessEncoder = encoding.createEncoder()
            encoding.writeVarUint(awarenessEncoder, messageAwareness)
            encoding.writeVarUint8Array(awarenessEncoder,
                awarenessProtocol.encodeAwarenessUpdate(this.#awareness, Array.from(states.keys())))
            this.#send(socket, encoding.toUint8Array(awarenessEncoder))
        }
    }

    #receive(socket: WebSocket, message: Uint8Array): void {
        try {
            const encoder = encoding.createEncoder()
            const decoder = decoding.createDecoder(message)
            switch (decoding.readVarUint(decoder)) {
                case messageSync: {
                    encoding.writeVarUint(encoder, messageSync)
                    syncProtocol.readSyncMessage(decoder, encoder, this.#doc, socket)
                    // an answer that holds only its type has nothing to say
                    if (encoding.length(encoder) > 1) {this.#send(socket, encoding.toUint8Array(encoder))}
                    break
                }
                case messageAwareness: {
                    awarenessProtocol.applyAwarenessUpdate(this.#awareness, decoding.readVarUint8Array(decoder), socket)
                    break
                }
            }
        } catch (error) {
            console.error("Room message", error)
        }
    }

    #broadcast(message: Uint8Array): void {
        this.#conns.forEach(socket => this.#send(socket, message))
    }

    #send(socket: WebSocket, message: Uint8Array): void {
        try {
            socket.send(message)
        } catch (_error) {
            this.#close(socket)
        }
    }

    #close(socket: WebSocket): void {
        if (this.#conns.delete(socket)) {
            const ids = Array.from(this.#owner.entries()).filter(([_, owner]) => owner === socket).map(([id]) => id)
            ids.forEach(id => this.#owner.delete(id))
            awarenessProtocol.removeAwarenessStates(this.#awareness, ids, null)
        }
        try {socket.close()} catch (_error) {/* already closed */}
    }
}
