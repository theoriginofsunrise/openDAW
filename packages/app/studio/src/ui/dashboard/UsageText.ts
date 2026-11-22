import type {EchoUsage} from "@opendaw/studio-core"

// Sizes the way Cloudflare counts them: a gigabyte is a billion bytes.
export const formatBytes = (bytes: number): string => {
    if (bytes < 1_000) {return `${Math.round(bytes)} B`}
    if (bytes < 1_000_000) {return `${(bytes / 1_000).toFixed(bytes < 10_000 ? 1 : 0)} kB`}
    if (bytes < 1_000_000_000) {return `${(bytes / 1_000_000).toFixed(bytes < 10_000_000 ? 1 : 0)} MB`}
    return `${(bytes / 1_000_000_000).toFixed(2)} GB`
}

export const fractionUsed = (bytes: number, freeBytes: number): number =>
    freeBytes <= 0 ? 1 : Math.max(0, bytes / freeBytes)

export type Level = "ok" | "warn" | "full"

// green until 70%, orange until 90%, red from there: past 100% it is no longer free
export const levelOf = (fraction: number): Level => fraction >= 0.9 ? "full" : fraction >= 0.7 ? "warn" : "ok"

export const summaryText = (usage: EchoUsage): string => {
    const fraction = fractionUsed(usage.total.bytes, usage.freeBytes)
    return `${formatBytes(usage.total.bytes)} of ${formatBytes(usage.freeBytes)} (${Math.round(fraction * 100)}%)`
}

const files = (count: number): string => `${count} file${count === 1 ? "" : "s"}`

const kindLabels: ReadonlyArray<[keyof EchoUsage["kinds"], string]> = [
    ["samples", "Audio"], ["projects", "Projects"], ["rooms", "Live room transfers (deleted after a day)"], ["other", "Other (notes, lists)"]
]

/**
 * The details window: where the space goes, and the biggest files. `names` turns the id of an audio file into the name
 * it has in the list of samples.
 */
export const detailsText = (usage: EchoUsage, names: Readonly<Record<string, string>> = {}): string => {
    const lines = [summaryText(usage), ""]
    for (const [kind, label] of kindLabels) {
        const portion = usage.kinds[kind]
        lines.push(`${label}: ${formatBytes(portion.bytes)} in ${files(portion.objects)}`)
    }
    lines.push("", `Your own folder: ${formatBytes(usage.mine.bytes)} in ${files(usage.mine.objects)}`)
    if (usage.largest.length > 0) {
        lines.push("", "Biggest files:")
        for (const {path, bytes} of usage.largest) {
            const id = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(path)?.[1]
            const name = id === undefined ? undefined : names[id.toLowerCase()]
            lines.push(`${formatBytes(bytes)}  ${name === undefined ? path : `${name} (${path.split("/")[0]})`}`)
        }
    }
    return lines.join("\n")
}
