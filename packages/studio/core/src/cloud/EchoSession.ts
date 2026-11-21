// The login with the Echo storage server: a session token the server handed out after a Google sign-in. It is kept in
// this browser, so that a reload or a relaunch of the app does not ask again.
export namespace EchoSession {
    const Key = "opendaw-echo-session"

    export type Stored = {
        readonly token: string
        readonly email: string
        // seconds since 1970, as the server states it
        readonly expiresAt: number
    }

    // Stays a minute short of the end, so that a token is never used at the last moment.
    const Margin = 60 * 1000

    export const read = (nowMs: number = Date.now()): Stored | null => {
        try {
            const raw = localStorage.getItem(Key)
            if (raw === null) {return null}
            const stored: { token?: unknown, email?: unknown, expiresAt?: unknown } = JSON.parse(raw)
            return typeof stored.token === "string" && typeof stored.email === "string"
            && typeof stored.expiresAt === "number" && stored.expiresAt * 1000 - Margin > nowMs
                ? {token: stored.token, email: stored.email, expiresAt: stored.expiresAt} : null
        } catch (_error) {
            return null
        }
    }

    export const write = (session: Stored): void => {
        try {localStorage.setItem(Key, JSON.stringify(session))} catch (_error) {/* not remembered */}
    }

    export const clear = (): void => {
        try {localStorage.removeItem(Key)} catch (_error) {/* nothing to clear */}
    }
}
