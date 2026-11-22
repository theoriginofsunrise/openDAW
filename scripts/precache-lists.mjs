// Which of the files of a build the app needs to start. The service worker downloads these first and takes over as
// soon as they are there; everything else (the full list) follows in the background.

// The files a page names itself: scripts, styles, preloaded chunks, icons, the manifest.
export const referencedBy = html => {
    const found = new Set()
    for (const tag of html.match(/<(?:script|link)\b[^>]*>/gi) ?? []) {
        const match = /\b(?:src|href)\s*=\s*"(\/[^"?#]*)[^"]*"/i.exec(tag)
        if (match !== null && !match[1].startsWith("//")) {found.add(match[1])}
    }
    return [...found]
}

// "/" (the page itself), then every referenced file that is in the offline list, in the order of that list.
// available: the urls of the full list, as the service worker fetches them (percent-encoded).
export const criticalFiles = (html, available) => {
    const referenced = new Set(referencedBy(html).map(path => path.split("/").map(decodeURIComponent).map(encodeURIComponent).join("/")))
    return ["/", ...available.filter(url => url !== "/" && referenced.has(url))]
}
