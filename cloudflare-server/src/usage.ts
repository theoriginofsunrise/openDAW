import {R2Bucket} from "./types"

// What Cloudflare gives for nothing in R2: 10 GB stored (GB = a billion bytes there).
export const FreeBytes = 10_000_000_000

export type Kind = "projects" | "samples" | "rooms" | "other"

export type Portion = { bytes: number, objects: number }

export type Usage = {
    freeBytes: number
    // everything in the bucket, everybody's
    total: Portion
    // by kind, over the whole bucket
    kinds: Record<Kind, Portion>
    // what is in the signed-in person's own folder
    mine: Portion
    // the biggest files of the signed-in person's folder and of the shared folder of the live rooms
    largest: Array<{ path: string, bytes: number }>
    // when this was counted, milliseconds since 1970
    at: number
}

// "u/<person>/projects/..." is a project, ".../samples/..." is audio, "u/shared/..." is what live rooms hand around
export const kindOf = (key: string): Kind => {
    const [root, owner, area] = key.split("/")
    if (root !== "u") {return "other"}
    if (owner === "shared") {return "rooms"}
    if (area === "projects") {return "projects"}
    if (area === "samples") {return "samples"}
    return "other"
}

const empty = (): Portion => ({bytes: 0, objects: 0})

const LargestCount = 10

/** Counts what is stored. Lists the bucket (one call per thousand files). */
export const countUsage = async (bucket: R2Bucket, userId: string, nowMs: number): Promise<Usage> => {
    const total = empty()
    const mine = empty()
    const kinds: Record<Kind, Portion> = {projects: empty(), samples: empty(), rooms: empty(), other: empty()}
    const biggest: Array<{ path: string, bytes: number }> = []
    const ownPrefix = `u/${userId}/`
    let cursor: string | undefined = undefined
    do {
        const page: Awaited<ReturnType<R2Bucket["list"]>> = await bucket.list({prefix: "", cursor, limit: 1000})
        for (const object of page.objects) {
            total.bytes += object.size
            total.objects++
            const kind = kindOf(object.key)
            kinds[kind].bytes += object.size
            kinds[kind].objects++
            const isMine = object.key.startsWith(ownPrefix)
            if (isMine) {
                mine.bytes += object.size
                mine.objects++
            }
            if (isMine || kind === "rooms") {
                biggest.push({path: isMine ? object.key.slice(ownPrefix.length) : object.key.slice("u/".length), bytes: object.size})
                if (biggest.length > LargestCount * 4) {
                    biggest.sort((a, b) => b.bytes - a.bytes)
                    biggest.length = LargestCount
                }
            }
        }
        cursor = page.truncated ? page.cursor : undefined
    } while (cursor !== undefined)
    biggest.sort((a, b) => b.bytes - a.bytes)
    return {freeBytes: FreeBytes, total, kinds, mine, largest: biggest.slice(0, LargestCount), at: nowMs}
}

// Counting lists the whole bucket, which is billed per call: a count is reused for a minute.
const cache = new Map<string, Usage>()
const MaxAgeMs = 60 * 1000

export const usageOf = async (bucket: R2Bucket, userId: string, nowMs: number, fresh: boolean = false): Promise<Usage> => {
    const known = cache.get(userId)
    if (!fresh && known !== undefined && nowMs - known.at < MaxAgeMs) {return known}
    const usage = await countUsage(bucket, userId, nowMs)
    cache.set(userId, usage)
    return usage
}

export const forgetUsage = (): void => cache.clear()
