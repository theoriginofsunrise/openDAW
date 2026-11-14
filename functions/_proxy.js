// Same-origin proxy for the studio's content servers (Cloudflare Pages Functions).
// The browser blocks direct requests to opendaw.studio's servers from other websites (CORS), but a request
// made by this function runs server-side, where CORS does not apply.
export const proxy = upstream => async ({request, params}) => {
    const path = [].concat(params.path ?? []).join("/")
    const search = new URL(request.url).search
    const proxied = new Request(`${upstream}/${path}${search}`, request)
    for (const name of ["origin", "referer", "cookie"]) {proxied.headers.delete(name)}
    const response = await fetch(proxied)
    const result = new Response(response.body, response)
    result.headers.delete("set-cookie")
    result.headers.set("Cross-Origin-Resource-Policy", "same-origin")
    return result
}
