import {UUID} from "@opendaw/lib-std"
import {ProjectStorage} from "../project/ProjectStorage"
import {CloudHandler} from "./CloudHandler"
import {CloudBackupProjects} from "./CloudBackupProjects"
import {CloudSyncBase} from "./CloudSyncBase"

type Stamped = { readonly modified: string }
type Catalog = { readonly [uuid: UUID.String]: Stamped }

// What a sync would do right now, without doing it. It follows the same rules as the sync itself
// (CloudBackupProjects), so "nothing to do" here means the sync would change nothing.
export type SyncStatus = {
    // new or changed on this device: goes up
    readonly push: ReadonlyArray<UUID.String>
    // new or changed in the cloud: comes down
    readonly pull: ReadonlyArray<UUID.String>
    // changed on both sides, or no history to tell: the sync asks what to do
    readonly decide: ReadonlyArray<UUID.String>
    // deleted on one side and not yet carried over to the other: the sync asks or records it
    readonly deletions: ReadonlyArray<UUID.String>
    readonly count: number
}

export namespace CloudSyncStatus {
    export type Inputs = {
        // projects stored on this device
        readonly local: Catalog
        // projects listed in the cloud
        readonly cloud: Catalog
        // projects deleted on this device
        readonly trashed: ReadonlyArray<UUID.String>
        // projects deleted on any device, as recorded in the cloud
        readonly tombstones: ReadonlyArray<UUID.String>
        // the cloud stamp each project had at this device's last sync
        readonly bases: { readonly [uuid: UUID.String]: string }
    }

    export const compute = ({local, cloud, trashed, tombstones, bases}: Inputs): SyncStatus => {
        const push: Array<UUID.String> = []
        const pull: Array<UUID.String> = []
        const decide: Array<UUID.String> = []
        const deletions: Array<UUID.String> = []
        const ids = (catalog: Catalog) => Object.keys(catalog) as Array<UUID.String>
        for (const uuid of ids(local)) {
            const inCloud = cloud[uuid]
            if (tombstones.includes(uuid)) {
                deletions.push(uuid) // deleted elsewhere: the sync asks whether to delete it here too
            } else if (inCloud === undefined) {
                push.push(uuid)
            } else {
                switch (CloudSyncBase.verdict(local[uuid].modified, inCloud.modified, bases[uuid])) {
                    case "upload":
                        push.push(uuid)
                        break
                    case "download":
                        pull.push(uuid)
                        break
                    case "both-changed":
                    case "unknown-history":
                        decide.push(uuid)
                        break
                }
            }
        }
        for (const uuid of ids(cloud)) {
            if (local[uuid] !== undefined || tombstones.includes(uuid)) {continue}
            if (trashed.includes(uuid)) {
                deletions.push(uuid) // deleted here, still in the cloud: the sync asks whether to delete it there
            } else {
                pull.push(uuid)
            }
        }
        for (const uuid of trashed) {
            // deleted here and already gone from the cloud: the sync records it for the other devices
            if (cloud[uuid] === undefined && !tombstones.includes(uuid)) {deletions.push(uuid)}
        }
        return {push, pull, decide, deletions, count: push.length + pull.length + decide.length + deletions.length}
    }

    // Reads the two sides and computes the status. Needs a handler whose login is valid.
    export const check = async (cloudHandler: CloudHandler, service: string): Promise<SyncStatus> => {
        const [list, trashed, remote] = await Promise.all([
            ProjectStorage.listProjects(),
            ProjectStorage.loadTrashedIds(),
            CloudBackupProjects.remoteState(cloudHandler)
        ])
        const local = list.reduce((record: { [uuid: UUID.String]: Stamped }, {uuid, meta}) => {
            record[UUID.toString(uuid)] = {modified: meta.modified}
            return record
        }, {})
        return compute({
            local, cloud: remote.catalog, trashed, tombstones: remote.tombstones, bases: CloudSyncBase.load(service)
        })
    }
}
