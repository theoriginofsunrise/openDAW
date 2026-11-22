import {Env} from "./types"
import {Jwk, signSession, verifyRs256, verifySession} from "./jwt"

const GoogleKeysUrl = "https://www.googleapis.com/oauth2/v3/certs"
const GoogleIssuers = ["accounts.google.com", "https://accounts.google.com"]
const ClockSkewSeconds = 60

export const SessionLifetimeSeconds = 30 * 24 * 60 * 60

let keyCache: { keys: ReadonlyArray<Jwk>, until: number } | null = null

export const resetKeyCache = (): void => {keyCache = null}

export const loadGoogleKeys = async (env: Env, fetcher: typeof fetch = fetch,
                                     nowMs: number = Date.now(), fresh: boolean = false): Promise<ReadonlyArray<Jwk>> => {
    if (env.JWKS_OVERRIDE !== undefined && env.JWKS_OVERRIDE !== "") {
        return (JSON.parse(env.JWKS_OVERRIDE) as { keys: Array<Jwk> }).keys
    }
    if (!fresh && keyCache !== null && keyCache.until > nowMs) {return keyCache.keys}
    const response = await fetcher(GoogleKeysUrl)
    if (!response.ok) {throw new Error(`Could not load Google's keys (${response.status})`)}
    const {keys} = await response.json() as { keys: Array<Jwk> }
    keyCache = {keys, until: nowMs + 60 * 60 * 1000}
    return keys
}

export const allowedEmails = (env: Env): ReadonlyArray<string> =>
    env.ALLOWED_EMAILS.split(",").map(email => email.trim().toLowerCase()).filter(email => email.length > 0)

export type GoogleResult = { ok: true, email: string } | { ok: false, status: number, error: string, message: string }

const fail = (status: number, error: string, message: string): GoogleResult => ({ok: false, status, error, message})

/**
 * Checks a Google ID token: signed by Google, meant for this app, fresh, issued for the nonce this login started
 * with, and for an email address that is on the allow list.
 */
export const verifyGoogleIdToken = async (env: Env, idToken: string, nonce: string, nowMs: number = Date.now(),
                                          fetcher: typeof fetch = fetch): Promise<GoogleResult> => {
    if (env.GOOGLE_CLIENT_ID === "") {return fail(500, "server_not_configured", "The server has no Google client id.")}
    const allowed = allowedEmails(env)
    if (allowed.length === 0) {return fail(500, "server_not_configured", "The server has no allowed emails.")}
    let verified = await verifyRs256(idToken, await loadGoogleKeys(env, fetcher, nowMs))
    if (verified === null && (env.JWKS_OVERRIDE === undefined || env.JWKS_OVERRIDE === "")) {
        // Google rotates its keys: look once more with fresh ones before refusing
        verified = await verifyRs256(idToken, await loadGoogleKeys(env, fetcher, nowMs, true))
    }
    if (verified === null) {return fail(401, "bad_token", "The Google login could not be verified.")}
    const {payload} = verified
    const nowSeconds = Math.floor(nowMs / 1000)
    if (typeof payload.iss !== "string" || !GoogleIssuers.includes(payload.iss)) {
        return fail(401, "bad_token", "The login was not issued by Google.")
    }
    if (payload.aud !== env.GOOGLE_CLIENT_ID) {return fail(401, "bad_token", "The login is meant for another app.")}
    if (typeof payload.exp !== "number" || payload.exp + ClockSkewSeconds <= nowSeconds) {
        return fail(401, "expired", "The Google login has expired. Sign in again.")
    }
    if (nonce === "" || payload.nonce !== nonce) {return fail(401, "bad_token", "The login does not match this attempt.")}
    if (typeof payload.email !== "string" || payload.email_verified !== true) {
        return fail(401, "bad_token", "The Google account has no verified email.")
    }
    const email = payload.email.toLowerCase()
    if (!allowed.includes(email)) {return fail(403, "not_allowed", `${email} is not allowed on this server.`)}
    return {ok: true, email}
}

// Every person gets a private folder in the bucket, named after a hash of their email.
export const userIdFor = async (email: string): Promise<string> => {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(email.toLowerCase()))
    return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, "0")).join("").slice(0, 32)
}

export const issueSession = async (env: Env, email: string, nowSeconds: number): Promise<{ token: string, expiresAt: number }> => {
    const secret = env.SESSION_SECRET
    if (secret === undefined || secret === "") {throw new Error("SESSION_SECRET is not set")}
    const expiresAt = nowSeconds + SessionLifetimeSeconds
    return {token: await signSession(secret, {sub: email, iat: nowSeconds, exp: expiresAt}), expiresAt}
}

export type Identity = { email: string, userId: string, expiresAt: number }

// The person behind a request, or null. The email must still be on the allow list: removing it ends the access.
export const authenticateToken = async (env: Env, token: string, nowSeconds: number): Promise<Identity | null> => {
    const secret = env.SESSION_SECRET
    if (secret === undefined || secret === "") {return null}
    const claims = await verifySession(secret, token, nowSeconds)
    if (claims === null) {return null}
    const email = claims.sub.toLowerCase()
    if (!allowedEmails(env).includes(email)) {return null}
    return {email, userId: await userIdFor(email), expiresAt: claims.exp}
}

export const authenticate = async (env: Env, request: Request, nowSeconds: number): Promise<Identity | null> => {
    const header = request.headers.get("Authorization")
    if (header === null || !header.startsWith("Bearer ")) {return null}
    return authenticateToken(env, header.slice("Bearer ".length).trim(), nowSeconds)
}
