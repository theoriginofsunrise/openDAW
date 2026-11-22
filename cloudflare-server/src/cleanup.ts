import {R2Bucket} from "./types"

// The folder every signed-in person can read and write: audio files that people in a live room hand to each other.
export const SharedPrefix = "u/shared/"

export const SharedMaxAgeMs = 24 * 60 * 60 * 1000

/**
 * Removes what has been lying in the shared folder for more than a day. A room only needs its audio while people are
 * in it; everybody keeps their own copy of what they used. Never touches anybody's own files.
 */
export const cleanShared = async (bucket: R2Bucket, nowMs: number, maxAgeMs: number = SharedMaxAgeMs): Promise<number> => {
    let removed = 0
    let cursor: string | undefined = undefined
    do {
        const page: Awaited<ReturnType<R2Bucket["list"]>> = await bucket.list({prefix: SharedPrefix, cursor, limit: 1000})
        const old = page.objects.filter(object => nowMs - object.uploaded.getTime() > maxAgeMs).map(object => object.key)
        if (old.length > 0) {
            await bucket.delete(old)
            removed += old.length
        }
        cursor = page.truncated ? page.cursor : undefined
    } while (cursor !== undefined)
    return removed
}
