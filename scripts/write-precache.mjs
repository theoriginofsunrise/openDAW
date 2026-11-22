// Writes <dist>/precache.json (the list of files the service worker keeps, so that the app starts without a network)
// and <dist>/precache-critical.json (the few it must have before it can take over). Usage: node scripts/write-precache.mjs <dist folder>
import {readdirSync, readFileSync, statSync, writeFileSync} from "node:fs"
import {join, relative, sep} from "node:path"
import {criticalFiles} from "./precache-lists.mjs"

const root = process.argv[2]
if (root === undefined) {
    console.error("usage: node scripts/write-precache.mjs <dist folder>")
    process.exit(1)
}

// Not needed to start the studio, or too large to keep on a phone by default.
const skip = [
    /\.map$/, /\.br$/, /^manuals\//, /^docs\//, /^index\.html$/, /^sw\.js$/, /^precache\.json$/, /^_headers$/,
    /^overlay-preview/, /ort-.*\.wasm$/, /^models\//
]
const limit = 12 * 1024 * 1024

const files = []
const walk = folder => {
    for (const entry of readdirSync(folder, {withFileTypes: true})) {
        const path = join(folder, entry.name)
        if (entry.isDirectory()) {
            walk(path)
            continue
        }
        const name = relative(root, path).split(sep).join("/")
        if (skip.some(pattern => pattern.test(name)) || statSync(path).size > limit) {continue}
        files.push(`/${name.split("/").map(encodeURIComponent).join("/")}`)
    }
}
walk(root)
// "/" is the app shell (index.html as the server serves it)
const urls = ["/", ...files.sort()]
writeFileSync(join(root, "precache.json"), JSON.stringify(urls))
// the few files the start needs: the service worker takes over once these are downloaded (see public/sw.js)
const critical = criticalFiles(readFileSync(join(root, "index.html"), "utf8"), urls)
writeFileSync(join(root, "precache-critical.json"), JSON.stringify(critical))
console.log(`${urls.length} files in the offline list, ${critical.length} of them needed to start`)
