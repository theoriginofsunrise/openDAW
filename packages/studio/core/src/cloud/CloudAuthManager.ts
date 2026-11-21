import {
    asDefined,
    Errors,
    isDefined,
    isNull,
    Maps,
    panic,
    Provider,
    RuntimeNotifier,
    Terminable,
    TimeSpan
} from "@opendaw/lib-std"
import {Promises} from "@opendaw/lib-runtime"
import {CloudService} from "./CloudService"
import {CloudHandler} from "./CloudHandler"
import {DropboxHandler} from "./DropboxHandler"
import {EchoCloudHandler} from "./EchoCloudHandler"
import {EchoSession} from "./EchoSession"
import {GoogleDriveHandler} from "./GoogleDriveHandler"
import {SoundCloudApi} from "./SoundCloudApi"

type ClientIds = {
    Dropbox: string
    GoogleDrive: string
    SoundCloud?: string
    // address of our own storage server (cloudflare-server/); empty or missing: not used
    EchoServer?: string
}

export class CloudAuthManager {
    static create(clientIds: ClientIds): CloudAuthManager {return new CloudAuthManager(clientIds)}

    static async #createCodes(): Promise<{ codeVerifier: string; codeChallenge: string }> {
        const array = new Uint8Array(32)
        crypto.getRandomValues(array)
        const codeVerifier = btoa(String.fromCharCode(...array))
            .replace(/\+/g, "-")
            .replace(/\//g, "_")
            .replace(/=/g, "")
        const encoder = new TextEncoder()
        const data = encoder.encode(codeVerifier)
        const digest = await crypto.subtle.digest("SHA-256", data)
        const codeChallenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
            .replace(/\+/g, "-")
            .replace(/\//g, "_")
            .replace(/=/g, "")
        return {codeVerifier, codeChallenge}
    }

    readonly #clientIds: ClientIds

    readonly #memoizedHandlers = new Map<CloudService, () => Promise<CloudHandler>>()
    // handlers that logged in during this session, with the time their login runs out
    readonly #live = new Map<CloudService, { handler: CloudHandler, until: number }>()
    readonly #handlerObservers = new Set<() => void>()

    // The login (an access token, about an hour) is kept in this browser, so that a reload, a relaunch of the app
    // or a second tab does not ask again while the token is still good. Stays 5 minutes short of the real expiry.
    static readonly #TokenKey = "opendaw-cloud-token"
    static readonly #TokenLifetime = TimeSpan.minutes(55).millis()

    #readStoredToken(service: CloudService): { token: string, until: number } | null {
        try {
            const raw = localStorage.getItem(`${CloudAuthManager.#TokenKey}:${service}`)
            if (raw === null) {return null}
            const stored: { token?: unknown, until?: unknown } = JSON.parse(raw)
            return typeof stored.token === "string" && typeof stored.until === "number" && stored.until > Date.now()
                ? {token: stored.token, until: stored.until} : null
        } catch (_error) {
            return null
        }
    }

    #storeToken(service: CloudService, token: string): void {
        try {
            localStorage.setItem(`${CloudAuthManager.#TokenKey}:${service}`,
                JSON.stringify({token, until: Date.now() + CloudAuthManager.#TokenLifetime}))
        } catch (_error) {/* storage not available: the login just is not remembered */}
    }

    #forgetToken(service: CloudService): void {
        try {localStorage.removeItem(`${CloudAuthManager.#TokenKey}:${service}`)} catch (_error) {/* nothing to forget */}
    }

    #memoizedSoundCloud: Provider<Promise<SoundCloudApi>>

    private constructor(clientIds: ClientIds) {
        this.#clientIds = clientIds
        this.#memoizedSoundCloud = this.#createSoundCloudMemo()
    }

    soundCloud(): Promise<SoundCloudApi> {return this.#memoizedSoundCloud()}

    /** Our own storage server is set up for this build. */
    get echoEnabled(): boolean {return isDefined(this.#clientIds.EchoServer) && this.#clientIds.EchoServer !== ""}

    /** The email of the person signed in to the storage server, or null. */
    get echoEmail(): string | null {return this.echoEnabled ? EchoSession.read()?.email ?? null : null}

    signOutEcho(): void {this.#echoSessionEnded()}

    #echoHandler(session: EchoSession.Stored): EchoCloudHandler {
        return new EchoCloudHandler(asDefined(this.#clientIds.EchoServer, "No storage server"), session.token,
            (input, init) => fetch(input, init), () => this.#echoSessionEnded())
    }

    #echoSessionEnded(): void {
        EchoSession.clear()
        this.#memoizedHandlers.delete("Echo")
        this.#live.delete("Echo")
        this.#handlerObservers.forEach(observer => observer())
    }

    /**
     * A handler whose login is still valid, or null. Never opens a login window, so it is safe to call from a timer.
     */
    peekHandler(only?: CloudService): CloudHandler | null {
        const now = Date.now()
        for (const [service, entry] of this.#live) {
            if (entry.until <= now) {
                this.#live.delete(service)
            } else if (only === undefined || only === service) {
                return entry.handler
            }
        }
        // the storage server login lasts weeks: it survives reloads and relaunches
        if (this.echoEnabled && (only === undefined || only === "Echo")) {
            const session = EchoSession.read()
            if (session !== null) {
                const handler = this.#echoHandler(session)
                this.#live.set("Echo", {handler, until: session.expiresAt * 1000 - TimeSpan.minutes(1).millis()})
                return handler
            }
            if (only === "Echo") {return null}
        }
        // a login from before the last reload may still be good
        const stored = only === undefined || only === "GoogleDrive" ? this.#readStoredToken("GoogleDrive") : null
        if (stored !== null) {
            const handler = new GoogleDriveHandler(stored.token)
            this.#live.set("GoogleDrive", {handler, until: stored.until})
            return handler
        }
        return null
    }

    /** Called after every successful login (also after a refresh of an expired one). */
    subscribeHandler(observer: () => void): Terminable {
        this.#handlerObservers.add(observer)
        return {terminate: () => {this.#handlerObservers.delete(observer)}}
    }

    #createSoundCloudMemo(): Provider<Promise<SoundCloudApi>> {
        return Promises.memoizeAsync(() => this.#oauthPkceFlow({
            service: "SoundCloud",
            clientId: asDefined(this.#clientIds.SoundCloud, "No SoundCloud client id"),
            authUrlBase: "https://secure.soundcloud.com/authorize",
            tokenUrl: "https://api.opendaw.studio/soundcloud/token.php",
            scope: ""
        }).then(token => new SoundCloudApi(token, () => this.#memoizedSoundCloud = this.#createSoundCloudMemo())),
            TimeSpan.minutes(55))
    }

    async getHandler(service: CloudService): Promise<CloudHandler> {
        const memo = Maps.createIfAbsent(this.#memoizedHandlers, service, service => {
            switch (service) {
                case "Dropbox": {
                    return Promises.memoizeAsync(this.#oauthDropbox.bind(this), TimeSpan.hours(1))
                }
                case "GoogleDrive": {
                    return Promises.memoizeAsync(this.#oauthGoogle.bind(this), TimeSpan.hours(1))
                }
                case "Echo": {
                    return Promises.memoizeAsync(this.#loginEcho.bind(this), TimeSpan.hours(1))
                }
                default:
                    return panic(`Unsupported service: ${service}`)
            }
        })
        const handler = await memo()
        const {status, error} = await Promises.tryCatch(handler.alive())
        if (status === "rejected") {
            // Do not auto-retry here to avoid reopening the OAuth popup in a loop.
            // Instead, clear the memoized handler and surface the error to the caller.
            this.#memoizedHandlers.delete(service)
            return Promise.reject(error)
        }
        console.debug(`Handler for '${service}' is alive`)
        // the login lasts about an hour (the storage server's login: weeks), stay clear of the end
        const until = service === "Echo"
            ? (EchoSession.read()?.expiresAt ?? 0) * 1000 - TimeSpan.minutes(1).millis()
            : Date.now() + TimeSpan.minutes(50).millis()
        this.#live.set(service, {handler, until})
        this.#handlerObservers.forEach(observer => observer())
        return handler
    }

    async #oauthPkceFlow(config: {
        service: string
        clientId: string
        authUrlBase: string
        tokenUrl: string
        scope: string
        extraAuthParams?: Record<string, string>
        extraTokenParams?: Record<string, string>
    }): Promise<string> {
        const redirectUri = `${location.origin}/auth-callback.html`
        const {codeVerifier, codeChallenge} = await CloudAuthManager.#createCodes()
        const params = new URLSearchParams({
            client_id: config.clientId,
            response_type: "code",
            redirect_uri: redirectUri,
            scope: config.scope,
            code_challenge: codeChallenge,
            code_challenge_method: "S256",
            ...(config.extraAuthParams ?? {})
        })
        const authUrl = `${config.authUrlBase}?${params.toString()}`
        console.debug("[CloudAuth] Opening auth window:", authUrl)
        const authWindow = window.open(authUrl, "cloudAuth")
        if (isNull(authWindow)) {
            return Errors.warn("Failed to open authentication window. Please check popup blockers.")
        }
        const {resolve, reject, promise} = Promise.withResolvers<string>()
        const channel = new BroadcastChannel("auth-callback")
        const dialog = RuntimeNotifier.progress({
            headline: "Cloud Service",
            message: "Please wait for authentication...",
            cancel: () => reject("cancelled")
        })
        let handled = false
        channel.onmessage = async (event: MessageEvent<any>) => {
            const data = asDefined(event.data, "No data")
            console.debug("[CloudAuth] Received via BroadcastChannel")
            if (data.type === "auth-callback" && isDefined(data.code)) {
                if (handled) {return}
                handled = true
                console.debug("[CloudAuth] Processing code from BroadcastChannel...", data.type, data.code)
                try {
                    const tokenParams = new URLSearchParams({
                        code: data.code,
                        grant_type: "authorization_code",
                        client_id: config.clientId,
                        redirect_uri: redirectUri,
                        code_verifier: codeVerifier,
                        ...(config.extraTokenParams ?? {})
                    })
                    const response = await fetch(config.tokenUrl, {
                        method: "POST",
                        headers: {"Content-Type": "application/x-www-form-urlencoded"},
                        body: tokenParams.toString()
                    })
                    if (!response.ok) {
                        const errorText = await response.text()
                        console.error("[CloudAuth] Token exchange error:", errorText)
                        return panic(`Token exchange failed: ${errorText}`)
                    }
                    const dataJson = await response.json()
                    const accessToken = dataJson.access_token
                    if (!accessToken) {
                        return panic("No access_token in token response")
                    }
                    resolve(accessToken)
                } catch (err) {
                    console.debug("[CloudAuth] Token exchange failed:", err)
                    reject(err)
                }
            } else if (data.type === "closed") {
                // Only reject if we did not already start handling a code
                if (!handled) {
                    console.debug("[CloudAuth] Callback window closed before code received")
                    reject(null)
                }
            }
        }
        return promise.finally(() => {
            console.debug("[CloudAuth] Closing auth window")
            authWindow.close()
            dialog.terminate()
            channel.close()
        })
    }

    async #oauthDropbox(): Promise<CloudHandler> {
        return this.#oauthPkceFlow({
            service: "dropbox",
            clientId: this.#clientIds.Dropbox,
            authUrlBase: "https://www.dropbox.com/oauth2/authorize",
            tokenUrl: "https://api.dropboxapi.com/oauth2/token",
            scope: "", // Dropbox scope is optional
            extraAuthParams: {
                token_access_type: "offline"
            }
        }).then(token => this.#createHandler("dropbox", token))
    }

    async #oauthGoogle(): Promise<CloudHandler> {
        const stored = this.#readStoredToken("GoogleDrive")
        if (stored !== null) {
            const handler = new GoogleDriveHandler(stored.token)
            const {status} = await Promises.tryCatch(handler.alive())
            if (status === "resolved") {
                console.debug("[CloudAuth] Reusing the stored Google login")
                return handler
            }
            // revoked or expired earlier than expected: log in again
            this.#forgetToken("GoogleDrive")
        }
        const clientId = this.#clientIds.GoogleDrive
        const scope = "https://www.googleapis.com/auth/drive.appdata"
        const redirectUri = `${location.origin}/auth-callback.html`
        const params = new URLSearchParams({
            client_id: clientId,
            response_type: "token",
            redirect_uri: redirectUri,
            scope,
            include_granted_scopes: "true"
        })
        const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
        console.debug("[CloudAuth] Opening auth window:", authUrl)
        const authWindow = window.open(authUrl, "cloudAuth")
        if (isNull(authWindow)) {
            return Errors.warn("Failed to open authentication window. Please check popup blockers.")
        }
        const {resolve, reject, promise} = Promise.withResolvers<CloudHandler>()
        const channel = new BroadcastChannel("auth-callback")
        const dialog = RuntimeNotifier.progress({
            headline: "Google Drive",
            message: "Please authorize access to app data...",
            cancel: () => reject("cancelled")
        })
        channel.onmessage = async (event: MessageEvent<any>) => {
            const data = asDefined(event.data, "No data")
            console.debug("[CloudAuth] Received via BroadcastChannel:", data)
            if (data.type === "auth-callback" && isDefined(data.access_token)) {
                try {
                    const accessToken = data.access_token
                    this.#storeToken("GoogleDrive", accessToken)
                    resolve(await this.#createHandler("google", accessToken))
                } catch (err) {
                    reject(err)
                }
            } else if (data.type === "closed") {
                console.debug("[CloudAuth] Callback window closed")
                reject(null)
            }
        }
        return promise.finally(() => {
            console.debug("[CloudAuth] Closing auth window")
            authWindow.close()
            dialog.terminate()
            channel.close()
        })
    }

    // Signs in with Google (an ID token, nothing is read from the person's Google account but the email) and trades it
    // for a session with the storage server, which only accepts the emails on its allow list.
    async #loginEcho(): Promise<CloudHandler> {
        const server = asDefined(this.#clientIds.EchoServer, "No storage server").replace(/\/+$/, "")
        const stored = EchoSession.read()
        if (stored !== null) {
            const handler = this.#echoHandler(stored)
            const {status} = await Promises.tryCatch(handler.alive())
            if (status === "resolved") {
                console.debug("[CloudAuth] Reusing the storage server login")
                return handler
            }
            EchoSession.clear()
        }
        const random = new Uint8Array(16)
        crypto.getRandomValues(random)
        const nonce = btoa(String.fromCharCode(...random)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "")
        const params = new URLSearchParams({
            client_id: this.#clientIds.GoogleDrive,
            response_type: "id_token",
            redirect_uri: `${location.origin}/auth-callback.html`,
            scope: "openid email",
            nonce,
            prompt: "select_account"
        })
        const authWindow = window.open(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`, "cloudAuth")
        if (isNull(authWindow)) {
            return Errors.warn("Failed to open authentication window. Please check popup blockers.")
        }
        const {resolve, reject, promise} = Promise.withResolvers<CloudHandler>()
        const channel = new BroadcastChannel("auth-callback")
        const dialog = RuntimeNotifier.progress({
            headline: "Echo Studio",
            message: "Please sign in with Google...",
            cancel: () => reject("cancelled")
        })
        channel.onmessage = async (event: MessageEvent<any>) => {
            const data = asDefined(event.data, "No data")
            if (data.type === "auth-callback" && isDefined(data.id_token)) {
                try {
                    const response = await fetch(`${server}/auth/google`, {
                        method: "POST",
                        headers: {"Content-Type": "application/json"},
                        body: JSON.stringify({idToken: data.id_token, nonce})
                    })
                    const body = await response.json().catch(() => ({}))
                    if (!response.ok) {
                        return reject(new Error(body.message ?? `The storage server refused the login (${response.status})`))
                    }
                    const session: EchoSession.Stored = {token: body.token, email: body.email, expiresAt: body.expiresAt}
                    EchoSession.write(session)
                    resolve(this.#echoHandler(session))
                } catch (err) {
                    reject(err)
                }
            } else if (data.type === "closed") {
                reject(null)
            }
        }
        return promise.finally(() => {
            authWindow.close()
            dialog.terminate()
            channel.close()
        })
    }

    async #createHandler(service: string, token: string): Promise<CloudHandler> {
        switch (service) {
            case "dropbox": {
                return new DropboxHandler(token)
            }
            case "google": {
                return new GoogleDriveHandler(token)
            }
            default:
                return panic(`Handler not implemented for service: ${service}`)
        }
    }
}