import {Errors, panic, Procedure, tryCatch, UUID} from "@opendaw/lib-std"
import {CloudHandler} from "./CloudHandler"

// Deleting for good is the one decision that has to reach every device, so the tombstones travel while the
// trash stays home. The union only grows here: a device that has been offline for months must not resurrect
// what the others deleted.
export namespace CloudBackupTombstones {
    export const FileName = "tombstones.json"

    export const read = (cloudHandler: CloudHandler, remotePath: string): Promise<ReadonlyArray<UUID.String>> =>
        cloudHandler.download(`${remotePath}/${FileName}`)
            .then(bytes => parse(bytes))
            .catch(reason => reason instanceof Errors.FileNotFound ? [] : panic(reason))

    // Takes ids back out: a deletion that was cancelled must stop travelling, or the other devices would still
    // act on it.
    export const forget = async (cloudHandler: CloudHandler,
                                 remotePath: string,
                                 uuids: ReadonlyArray<UUID.String>): Promise<void> => {
        const current = await read(cloudHandler, remotePath)
        const next = current.filter(uuid => !uuids.includes(uuid))
        if (next.length === current.length) {return}
        await cloudHandler.upload(`${remotePath}/${FileName}`,
            new TextEncoder().encode(JSON.stringify(next)).buffer as ArrayBuffer)
    }

    export const sync = async (cloudHandler: CloudHandler,
                               remotePath: string,
                               local: ReadonlyArray<UUID.String>,
                               log: Procedure<string>): Promise<ReadonlyArray<UUID.String>> => {
        const path = `${remotePath}/${FileName}`
        const remote = await cloudHandler.download(path)
            .then(bytes => parse(bytes))
            .catch(reason => reason instanceof Errors.FileNotFound ? [] : panic(reason))
        const union = Array.from(new Set([...remote, ...local]))
        if (union.length > local.length || union.length > remote.length) {
            log("Syncing deletions...")
            await cloudHandler.upload(path, new TextEncoder().encode(JSON.stringify(union)).buffer as ArrayBuffer)
        }
        return union
    }

    const parse = (bytes: ArrayBuffer): ReadonlyArray<UUID.String> => {
        const result = tryCatch(() => JSON.parse(new TextDecoder().decode(bytes)) as ReadonlyArray<UUID.String>)
        return result.status === "success" && Array.isArray(result.value) ? result.value : []
    }
}
