import {Env} from "./types"

/**
 * The go-between of the peer-to-peer connections (following someone's playhead, calls, sending audio files straight
 * from one person to another): people subscribe to a topic, and what one publishes goes to the others on the topic.
 * What packages/server/yjs-server does on its own machine, on the path /signaling.
 */
export class Signaling {
    readonly #topics = new Map<string, Set<WebSocket>>()
    readonly #subscriptions = new Map<WebSocket, Set<string>>()

    constructor(_state: unknown, _env: Env) {}

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
        this.#subscriptions.set(socket, new Set())
        socket.addEventListener("message", event => {
            if (typeof event.data !== "string") {return}
            this.#receive(socket, event.data)
        })
        socket.addEventListener("close", () => this.#drop(socket))
        socket.addEventListener("error", () => this.#drop(socket))
    }

    #receive(socket: WebSocket, raw: string): void {
        let message: { type?: string, topics?: Array<string>, topic?: string }
        try {
            message = JSON.parse(raw)
        } catch (_error) {
            return
        }
        switch (message.type) {
            case "subscribe": {
                (message.topics ?? []).forEach(topic => {
                    if (typeof topic !== "string") {return}
                    this.#subscriptions.get(socket)?.add(topic)
                    let subscribers = this.#topics.get(topic)
                    if (subscribers === undefined) {
                        subscribers = new Set()
                        this.#topics.set(topic, subscribers)
                    }
                    subscribers.add(socket)
                })
                break
            }
            case "unsubscribe": {
                (message.topics ?? []).forEach(topic => {
                    this.#subscriptions.get(socket)?.delete(topic)
                    this.#leave(socket, topic)
                })
                break
            }
            case "publish": {
                if (typeof message.topic !== "string") {break}
                this.#topics.get(message.topic)?.forEach(subscriber => {
                    if (subscriber === socket) {return}
                    try {subscriber.send(raw)} catch (_error) {this.#drop(subscriber)}
                })
                break
            }
            case "ping": {
                try {socket.send(JSON.stringify({type: "pong"}))} catch (_error) {this.#drop(socket)}
                break
            }
        }
    }

    #leave(socket: WebSocket, topic: string): void {
        const subscribers = this.#topics.get(topic)
        if (subscribers === undefined) {return}
        subscribers.delete(socket)
        if (subscribers.size === 0) {this.#topics.delete(topic)}
    }

    #drop(socket: WebSocket): void {
        this.#subscriptions.get(socket)?.forEach(topic => this.#leave(socket, topic))
        this.#subscriptions.delete(socket)
        try {socket.close()} catch (_error) {/* already closed */}
    }
}
