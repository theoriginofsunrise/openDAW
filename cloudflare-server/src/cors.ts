import {Env} from "./types"

export const allowedOrigin = (env: Env, origin: string | null): string | null => {
    if (origin === null) {return null}
    const allowed = env.ALLOWED_ORIGINS.split(",").map(entry => entry.trim()).filter(entry => entry.length > 0)
    return allowed.includes(origin) ? origin : null
}

const corsHeaders = (request: Request, env: Env): Headers => {
    const headers = new Headers()
    const origin = allowedOrigin(env, request.headers.get("Origin"))
    if (origin !== null) {
        headers.set("Access-Control-Allow-Origin", origin)
        headers.set("Access-Control-Allow-Methods", "GET, HEAD, PUT, POST, DELETE, OPTIONS")
        headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Echo-If-Match")
        headers.set("Access-Control-Expose-Headers", "ETag")
        headers.set("Access-Control-Max-Age", "86400")
    }
    headers.append("Vary", "Origin")
    // the app page is cross-origin isolated: let it read what this server sends
    headers.set("Cross-Origin-Resource-Policy", "cross-origin")
    return headers
}

export const preflight = (request: Request, env: Env): Response =>
    new Response(null, {status: 204, headers: corsHeaders(request, env)})

export const withCors = (response: Response, request: Request, env: Env): Response => {
    const headers = new Headers(response.headers)
    corsHeaders(request, env).forEach((value, key) => key === "vary" ? headers.append(key, value) : headers.set(key, value))
    return new Response(response.body, {status: response.status, statusText: response.statusText, headers})
}
