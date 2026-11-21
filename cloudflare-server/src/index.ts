import {Env} from "./types"
import {authenticate, issueSession, verifyGoogleIdToken} from "./auth"
import {preflight, withCors} from "./cors"
import {
    cleanPath,
    deleteFile,
    getFile,
    headFile,
    json,
    listFiles,
    multipartAbort,
    multipartComplete,
    multipartCreate,
    multipartPart,
    putFile
} from "./files"

const decodePath = (pathname: string, prefix: string): string | null => {
    try {
        return pathname.slice(prefix.length).split("/").map(decodeURIComponent).join("/")
    } catch (_error) {
        return null
    }
}

const route = async (request: Request, env: Env): Promise<Response> => {
    const url = new URL(request.url)
    const {pathname} = url
    const method = request.method
    const nowMs = Date.now()
    if (method === "OPTIONS") {return preflight(request, env)}
    if (pathname === "/" && method === "GET") {return json({ok: true, name: "echostudio-server"})}

    if (pathname === "/auth/google" && method === "POST") {
        const body = await request.json().catch(() => null) as { idToken?: unknown, nonce?: unknown } | null
        if (body === null || typeof body.idToken !== "string" || typeof body.nonce !== "string") {
            return json({error: "bad_request"}, 400)
        }
        if (env.SESSION_SECRET === undefined || env.SESSION_SECRET === "") {
            return json({error: "server_not_configured", message: "The server has no session secret yet."}, 500)
        }
        const result = await verifyGoogleIdToken(env, body.idToken, body.nonce, nowMs)
        if (!result.ok) {return json({error: result.error, message: result.message}, result.status)}
        const session = await issueSession(env, result.email, Math.floor(nowMs / 1000))
        return json({token: session.token, email: result.email, expiresAt: session.expiresAt})
    }

    const identity = await authenticate(env, request, Math.floor(nowMs / 1000))
    if (identity === null) {return json({error: "unauthorized"}, 401)}
    const {userId} = identity

    if (pathname === "/auth/me" && method === "GET") {return json({email: identity.email, expiresAt: identity.expiresAt})}

    if (pathname.startsWith("/files/")) {
        const decoded = decodePath(pathname, "/files/")
        const path = decoded === null ? null : cleanPath(decoded)
        if (path === null) {return json({error: "bad_path"}, 400)}
        switch (method) {
            case "GET":
                return getFile(env, userId, path)
            case "HEAD":
                return headFile(env, userId, path)
            case "PUT":
                return putFile(env, userId, path, request)
            case "DELETE":
                return deleteFile(env, userId, path)
        }
        return json({error: "method_not_allowed"}, 405)
    }

    if (pathname === "/list" && method === "GET") {
        const path = cleanPath(url.searchParams.get("path") ?? "", true)
        if (path === null) {return json({error: "bad_path"}, 400)}
        return listFiles(env, userId, path)
    }

    if (pathname.startsWith("/mpu/")) {
        const path = cleanPath(url.searchParams.get("path") ?? "")
        if (path === null) {return json({error: "bad_path"}, 400)}
        const uploadId = url.searchParams.get("uploadId") ?? ""
        if (pathname === "/mpu/create" && method === "POST") {return multipartCreate(env, userId, path)}
        if (uploadId === "") {return json({error: "bad_request"}, 400)}
        if (pathname === "/mpu/part" && method === "PUT") {
            return multipartPart(env, userId, path, uploadId, Number(url.searchParams.get("part")), request)
        }
        if (pathname === "/mpu/complete" && method === "POST") {return multipartComplete(env, userId, path, uploadId, request)}
        if (pathname === "/mpu/abort" && method === "POST") {return multipartAbort(env, userId, path, uploadId)}
    }
    return json({error: "not_found"}, 404)
}

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        try {
            return withCors(await route(request, env), request, env)
        } catch (error) {
            console.error(error)
            return withCors(json({error: "server_error"}, 500), request, env)
        }
    }
}
