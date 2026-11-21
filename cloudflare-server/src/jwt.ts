const encoder = new TextEncoder()

export const b64urlEncode = (bytes: Uint8Array): string => {
    let binary = ""
    for (let i = 0; i < bytes.length; i++) {binary += String.fromCharCode(bytes[i])}
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

export const b64urlDecode = (text: string): Uint8Array<ArrayBuffer> => {
    const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - text.length % 4) % 4)
    const binary = atob(padded)
    const bytes = new Uint8Array(new ArrayBuffer(binary.length))
    for (let i = 0; i < binary.length; i++) {bytes[i] = binary.charCodeAt(i)}
    return bytes
}

const jsonPart = (value: unknown): string => b64urlEncode(encoder.encode(JSON.stringify(value)))

const parseJsonPart = (part: string): Record<string, unknown> | null => {
    try {
        const parsed: unknown = JSON.parse(new TextDecoder().decode(b64urlDecode(part)))
        return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
            ? parsed as Record<string, unknown> : null
    } catch (_error) {
        return null
    }
}

const hmacKey = (secret: string, usages: Array<KeyUsage>): Promise<CryptoKey> =>
    crypto.subtle.importKey("raw", encoder.encode(secret), {name: "HMAC", hash: "SHA-256"}, false, usages)

export type SessionClaims = { sub: string, iat: number, exp: number }

// Our own session token (HS256): proves a person signed in with an allowed Google account.
export const signSession = async (secret: string, claims: SessionClaims): Promise<string> => {
    const data = `${jsonPart({alg: "HS256", typ: "JWT"})}.${jsonPart(claims)}`
    const signature = await crypto.subtle.sign("HMAC", await hmacKey(secret, ["sign"]), encoder.encode(data))
    return `${data}.${b64urlEncode(new Uint8Array(signature))}`
}

export const verifySession = async (secret: string, token: string, nowSeconds: number): Promise<SessionClaims | null> => {
    const parts = token.split(".")
    if (parts.length !== 3) {return null}
    const header = parseJsonPart(parts[0])
    if (header === null || header.alg !== "HS256") {return null}
    let valid = false
    try {
        valid = await crypto.subtle.verify("HMAC", await hmacKey(secret, ["verify"]),
            b64urlDecode(parts[2]), encoder.encode(`${parts[0]}.${parts[1]}`))
    } catch (_error) {
        return null
    }
    if (!valid) {return null}
    const claims = parseJsonPart(parts[1])
    if (claims === null || typeof claims.sub !== "string" || typeof claims.exp !== "number"
        || typeof claims.iat !== "number" || claims.exp <= nowSeconds) {return null}
    return {sub: claims.sub, iat: claims.iat, exp: claims.exp}
}

export type Jwk = { kid: string, kty: string, n: string, e: string, alg?: string, use?: string }

export type VerifiedJwt = { header: Record<string, unknown>, payload: Record<string, unknown> }

// A token signed by someone else (Google, RS256) against a set of public keys.
export const verifyRs256 = async (token: string, keys: ReadonlyArray<Jwk>): Promise<VerifiedJwt | null> => {
    const parts = token.split(".")
    if (parts.length !== 3) {return null}
    const header = parseJsonPart(parts[0])
    const payload = parseJsonPart(parts[1])
    if (header === null || payload === null || header.alg !== "RS256" || typeof header.kid !== "string") {return null}
    const jwk = keys.find(key => key.kid === header.kid && key.kty === "RSA")
    if (jwk === undefined) {return null}
    try {
        const key = await crypto.subtle.importKey("jwk", {kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256", ext: true},
            {name: "RSASSA-PKCS1-v1_5", hash: "SHA-256"}, false, ["verify"])
        const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key,
            b64urlDecode(parts[2]), encoder.encode(`${parts[0]}.${parts[1]}`))
        return valid ? {header, payload} : null
    } catch (_error) {
        return null
    }
}
