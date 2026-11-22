// Where the live rooms are. Without our own server in the build, the rooms of the openDAW project (which accepts
// only its own website, so they do not work from here). With it, rooms and the peer-to-peer go-between live on our
// Cloudflare server, and a connection carries the login (?token=...) because a browser cannot send a header with it.
export namespace RoomServer {
    const Upstream = "wss://live.opendaw.studio"

    let config: { url: string, token: () => string | null } | null = null

    export const configure = (serverUrl: string, token: () => string | null): void => {
        config = {url: serverUrl.trim().replace(/^http/i, "ws").replace(/\/+$/, ""), token}
    }

    /** Our own server is used. */
    export const ours = (): boolean => config !== null

    export const url = (): string => config?.url ?? Upstream

    export const token = (): string | null => config?.token() ?? null

    /** The address with the login added, when it is an address of our own server. Others stay as they are. */
    export const authorize = (address: string): string => {
        if (config === null || !address.startsWith(config.url)) {return address}
        const login = config.token()
        if (login === null) {return address}
        return `${address}${address.includes("?") ? "&" : "?"}token=${encodeURIComponent(login)}`
    }

    export const reset = (): void => {config = null}
}
