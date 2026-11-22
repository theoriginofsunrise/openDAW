// The parts of the Workers runtime that the standard type definitions do not know.
declare class WebSocketPair {
    0: WebSocket
    1: WebSocket
}

interface WebSocket {
    accept(): void
}

interface ResponseInit {
    webSocket?: WebSocket
}
