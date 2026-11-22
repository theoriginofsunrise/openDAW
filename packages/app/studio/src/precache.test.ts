import {describe, expect, it} from "vitest"
// @ts-ignore: a plain script, run by node in the build
import {criticalFiles, referencedBy} from "../../../../scripts/precache-lists.mjs"

const html = `<!doctype html><html><head>
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="stylesheet" crossorigin href="/assets/index-AbC123.css?v=2">
<link rel="modulepreload" crossorigin href="/assets/vendor-XyZ.js">
<link href="https://fonts.example/css" rel="stylesheet">
<link rel="preload" href="//cdn.example/x.js">
<script type="module" crossorigin src="/assets/index-AbC123.js"></script>
<script>console.log("inline")</script>
</head><body></body></html>`

describe("what the app needs to start", () => {
    it("finds the local files a page names, and leaves foreign ones", () => {
        expect(referencedBy(html).sort()).toEqual([
            "/apple-touch-icon.png", "/assets/index-AbC123.css", "/assets/index-AbC123.js", "/assets/vendor-XyZ.js",
            "/favicon.svg", "/manifest.webmanifest"
        ])
    })

    it("puts the page itself first, then the referenced files that are in the offline list, in its order", () => {
        const available = ["/", "/assets/a-big-chunk.js", "/assets/index-AbC123.js", "/assets/vendor-XyZ.js",
            "/assets/index-AbC123.css", "/favicon.svg", "/manifest.webmanifest", "/engine.wasm"]
        expect(criticalFiles(html, available)).toEqual([
            "/", "/assets/index-AbC123.js", "/assets/vendor-XyZ.js", "/assets/index-AbC123.css", "/favicon.svg", "/manifest.webmanifest"])
    })

    it("does not list a file the offline list has dropped (too big, or not needed)", () => {
        expect(criticalFiles(html, ["/", "/assets/index-AbC123.js"])).toEqual(["/", "/assets/index-AbC123.js"])
    })

    it("matches names that need escaping the way the list writes them", () => {
        const page = `<script src="/assets/index%20one.js"></script><link href="/a b/c.css" rel="stylesheet">`
        expect(criticalFiles(page, ["/", "/assets/index%20one.js", "/a%20b/c.css"]))
            .toEqual(["/", "/assets/index%20one.js", "/a%20b/c.css"])
    })

    it("is just the page for a page that names nothing", () => {
        expect(criticalFiles("<html></html>", ["/", "/x.js"])).toEqual(["/"])
    })
})
