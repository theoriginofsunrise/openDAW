import {
    Arrays,
    Errors,
    isAbsent,
    Maybe,
    Objects,
    panic,
    Procedure,
    Progress,
    Provider,
    RuntimeNotifier,
    TimeSpan,
    UUID
} from "@opendaw/lib-std"
import {network, Promises} from "@opendaw/lib-runtime"
import {ProjectMeta} from "../project/ProjectMeta"
import {ProjectStorage} from "../project/ProjectStorage"
import {CloudHandler} from "./CloudHandler"
import {Workers} from "../Workers"
import {ProjectPaths} from "../project/ProjectPaths"
import {CloudSyncBase} from "./CloudSyncBase"
import {CloudSyncHooks} from "./CloudSyncHooks"

// these get indexed in the cloud with the uuid in the cloud's catalog
const catalogFields = ["name", "modified", "created", "tags", "description"] as const

type CatalogFields = typeof catalogFields[number]
type MetaFields = Pick<ProjectMeta, CatalogFields>
type Projects = Record<UUID.String, MetaFields>

const listLocal = (): Promise<Projects> => ProjectStorage.listProjects()
    .then(list => list.reduce((record: Projects, entry: ProjectStorage.ListEntry) => {
        record[UUID.toString(entry.uuid)] = Objects.include(entry.meta, ...catalogFields)
        return record
    }, {}))

const downloadCatalog = (cloudHandler: CloudHandler): Promise<Projects> =>
    cloudHandler.download(CloudBackupProjects.RemoteCatalogPath)
        .then(json => JSON.parse(new TextDecoder().decode(json)))
        .catch(reason => reason instanceof Errors.FileNotFound ? {} : panic(reason))

export class CloudBackupProjects {
    static readonly RemotePath = "projects"
    static readonly RemoteCatalogPath = `${this.RemotePath}/index.json`

    static async start(cloudHandler: CloudHandler,
                       service: string,
                       progress: Progress.Handler,
                       log: Procedure<string>) {
        log("Collecting all project domains...")
        const [local, cloud] = await Promise.all([listLocal(), downloadCatalog(cloudHandler)])
        return new CloudBackupProjects(cloudHandler, service, local, cloud, log).#start(progress)
    }

    readonly #cloudHandler: CloudHandler
    // the cloud service ("GoogleDrive", ...): every service has its own sync history
    readonly #service: string
    readonly #log: Procedure<string>
    #local: Projects
    #cloud: Projects

    private constructor(cloudHandler: CloudHandler, service: string, local: Projects, cloud: Projects,
                        log: Procedure<string>) {
        this.#cloudHandler = cloudHandler
        this.#service = service
        this.#local = local
        this.#cloud = cloud
        this.#log = log
    }

    async #start(progress: Progress.Handler): Promise<void> {
        const trashed = await ProjectStorage.loadTrashedIds()
        const [reconcileProgress, uploadProgress, trashProgress, downloadProgress] =
            Progress.splitWithWeights(progress, [0.10, 0.40, 0.10, 0.40])
        const changedHere = await this.#reconcile(trashed, reconcileProgress)
        // conflict copies and updated projects changed what is stored on this device
        this.#local = await listLocal()
        await this.#upload(changedHere, uploadProgress)
        await this.#trash(trashed, trashProgress)
        await this.#download(trashed, downloadProgress)
    }

    /**
     * Projects that exist on both sides. Nothing here is ever overwritten without knowing who changed what:
     * the stamp the cloud copy had at the last sync (CloudSyncBase) says whether the cloud copy changed since,
     * and the stamp of the local copy says whether this device changed it.
     *   only this device changed it  -> goes up
     *   only the cloud changed it    -> comes down
     *   both, or no history to tell  -> the person decides
     * Returns the projects that are to be uploaded.
     */
    async #reconcile(trashed: ReadonlyArray<UUID.String>, progress: Progress.Handler): Promise<Set<UUID.String>> {
        const hooks = CloudSyncHooks.get()
        const bases = CloudSyncBase.load(this.#service)
        const upload = new Set<UUID.String>()
        const shared = Object.keys(this.#local)
            .map(uuid => UUID.asString(uuid))
            .filter(uuid => !isAbsent(this.#cloud[uuid]) && !trashed.includes(uuid))
        for (const [index, uuid] of shared.entries()) {
            progress((index + 1) / shared.length)
            const localMeta = this.#local[uuid]
            const cloudMeta = this.#cloud[uuid]
            const local = localMeta.modified
            const cloud = cloudMeta.modified
            const base: Maybe<string> = bases[uuid]
            const name = localMeta.name
            const verdict = CloudSyncBase.verdict(local, cloud, base)
            if (verdict === "same") {
                if (base !== cloud) {CloudSyncBase.set(this.#service, uuid, cloud)}
                continue
            }
            const open = hooks.isProjectOpen(uuid)
            if (verdict === "upload") {
                upload.add(uuid)
                continue
            }
            if (verdict === "download") {
                if (open) {
                    CloudSyncHooks.note(`'${name}' was changed on another device. It is open here: close it, then sync again to receive the update.`)
                    continue
                }
                if (await this.#fetchProject(uuid, cloudMeta.name)) {
                    CloudSyncBase.set(this.#service, uuid, cloud)
                    CloudSyncHooks.note(`'${name}' was updated from the cloud.`)
                }
                continue
            }
            const choice = await hooks.resolveConflict({uuid, name, local, cloud, open, reason: verdict})
            switch (choice) {
                case "use-mine":
                    upload.add(uuid)
                    break
                case "use-cloud":
                case "keep-both": {
                    if (open) {
                        CloudSyncHooks.note(`'${name}' is open here and was not touched: close it, then sync again.`)
                        break
                    }
                    if (choice === "keep-both") {
                        const copy = await hooks.createConflictCopy(uuid).catch(reason => {
                            console.warn(reason)
                            return null
                        })
                        if (copy === null) {
                            CloudSyncHooks.note(`'${name}' was left alone: the copy of your version could not be made.`)
                            break
                        }
                        CloudSyncHooks.note(`Your version of '${name}' was kept as '${copy}'.`)
                    }
                    if (await this.#fetchProject(uuid, cloudMeta.name)) {
                        CloudSyncBase.set(this.#service, uuid, cloud)
                        CloudSyncHooks.note(`'${name}' now has the cloud version.`)
                    }
                    break
                }
                case "skip":
                    CloudSyncHooks.note(`'${name}' differs from the cloud and was skipped.`)
                    break
            }
        }
        progress(1.0)
        return upload
    }

    async #upload(changedHere: ReadonlySet<UUID.String>, progress: Progress.Handler): Promise<void> {
        const local = this.#local
        const cloud = this.#cloud
        const isUnsynced = (uuid: UUID.String, cloudProject: Maybe<MetaFields>) =>
            isAbsent(cloudProject) || changedHere.has(uuid)
        const unsyncedProjects: ReadonlyArray<[UUID.String, MetaFields]> = Object.entries(local)
            .filter(([uuid]) => isUnsynced(UUID.asString(uuid), cloud[uuid as UUID.String]))
            .map(([uuid, localProject]) => ([UUID.asString(uuid), localProject]))
        if (unsyncedProjects.length === 0) {
            this.#log("No unsynced projects found.")
            progress(1.0)
            return
        }
        const uploaded = await Promises.sequentialAll(unsyncedProjects
            .map(([uuidAsString, meta]: [UUID.String, MetaFields], index, {length}) => async () => {
                progress((index + 1) / length)
                this.#log(`Uploading project '${meta.name}'`)
                const uuid = UUID.parse(uuidAsString)
                const folder = `${CloudBackupProjects.RemotePath}/${uuidAsString}`
                const metaFile = await ProjectStorage.loadMeta(uuid)
                const projectFile = await ProjectStorage.loadProject(uuid)
                const optCoverFile = await ProjectStorage.loadCover(uuid)
                const tasks: Array<Provider<Promise<void>>> = []
                const removeProjectPath = `${folder}/project.od`
                const remoteMetaPath = `${folder}/meta.json`
                tasks.push(() => this.#cloudHandler.upload(removeProjectPath, projectFile))
                tasks.push(() => this.#cloudHandler.upload(remoteMetaPath, metaFile))
                optCoverFile.ifSome(cover => {
                    const removeCoverPath = `${folder}/image.bin`
                    return tasks.push(() => this.#cloudHandler.upload(removeCoverPath, cover))
                })
                await Promises.approvedRetry(() =>
                    Promises.timeout(Promises.sequentialAll(tasks),
                        TimeSpan.minutes(10), "Upload timeout (10 min)."), error => ({
                    headline: "Upload failed",
                    message: `Failed to upload project '${meta.name}'. '${error}'`,
                    approveText: "Retry",
                    cancelText: "Cancel"
                }))
                // from now on this device and the cloud agree on this stamp
                CloudSyncBase.set(this.#service, uuidAsString, meta.modified)
                return {uuidAsString, meta}
            }))
        await this.#updateCatalog(uploaded.reduce((projects, project) => {
            projects[UUID.asString(project.uuidAsString)] = project.meta
            return projects
        }, {} as Projects), [])
        progress(1.0)
    }

    async #trash(trashed: ReadonlyArray<UUID.String>, progress: Progress.Handler): Promise<void> {
        const obsolete: Array<[string, MetaFields]> =
            Arrays.intersect(Object.entries(this.#cloud), trashed, ([uuid, _], trashed) => uuid === trashed)
        if (obsolete.length > 0) {
            const approved = await RuntimeNotifier.approve({
                headline: "Delete Projects?",
                message: `Found ${obsolete.length} locally deleted projects. Delete from cloud as well?`,
                approveText: "Yes",
                cancelText: "No"
            })
            if (approved) {
                const deleted: ReadonlyArray<UUID.String> = await Promises.sequentialAll(
                    obsolete.map(([uuid, meta], index, {length}) => async () => {
                        progress((index + 1) / length)
                        const path = `${CloudBackupProjects.RemotePath}/${uuid}`
                        this.#log(`Deleting '${meta.name}'`)
                        await this.#cloudHandler.delete(path)
                        CloudSyncBase.remove(this.#service, UUID.asString(uuid))
                        return UUID.asString(uuid)
                    }))
                await this.#updateCatalog({}, deleted)
            }
        }
        progress(1.0)
    }

    async #download(trashed: ReadonlyArray<UUID.String>, progress: Progress.Handler): Promise<void> {
        const cloud = this.#cloud
        const local = this.#local
        const compareFn = ([uuidA]: [string, MetaFields], [uuidB]: [string, MetaFields]) => uuidA === uuidB
        const missingLocally = Arrays.subtract(Object.entries(cloud), Object.entries(local), compareFn)
        const download = Arrays.subtract(missingLocally, trashed, ([projectUUID], uuid) => projectUUID === uuid)
        if (download.length === 0) {
            this.#log("No projects to download.")
            progress(1.0)
            return
        }
        await Promises.sequentialAll(
            download.map(([uuidAsString, meta], index, {length}) => async () => {
                progress((index + 1) / length)
                this.#log(`Downloading project '${meta.name}'`)
                const uuid = UUID.asString(uuidAsString)
                if (await this.#fetchProject(uuid, meta.name)) {
                    CloudSyncBase.set(this.#service, uuid, meta.modified)
                }
                return uuidAsString
            }))
        this.#log("Download projects complete.")
        progress(1.0)
    }

    /**
     * Writes the cloud copy of a project into local storage (a new project, or replacing the stored copy of an
     * existing one). Returns false when the cloud copy is incomplete.
     */
    async #fetchProject(uuidAsString: UUID.String, name: string): Promise<boolean> {
        const uuid = UUID.parse(uuidAsString)
        const path = `${CloudBackupProjects.RemotePath}/${uuidAsString}`
        const files = await Promises.guardedRetry(() =>
            this.#cloudHandler.list(path), network.defaultRetry)
        const hasProjectFile = files.includes("project.od")
        const hasMetaFile = files.includes("meta.json")
        if (!hasProjectFile || !hasMetaFile) {
            console.warn(`hasProjectFile: ${hasProjectFile}, hasMetaFile: ${hasMetaFile} for ${uuidAsString}`)
            const approvedDeletion = await RuntimeNotifier.approve({
                headline: "Download failed",
                message: `Project '${name}' is corrupted. Delete it from cloud?.`,
                approveText: "Yes",
                cancelText: "Ignore"
            })
            if (approvedDeletion) {
                await this.#cloudHandler.delete(path)
            }
            return false
        }
        const projectPath = `${path}/project.od`
        const metaPath = `${path}/meta.json`
        const coverPath = `${path}/image.bin`
        const projectArrayBuffer = await Promises.guardedRetry(() =>
            this.#cloudHandler.download(projectPath), network.defaultRetry)
        const metaArrayBuffer = await Promises.guardedRetry(() =>
            this.#cloudHandler.download(metaPath), network.defaultRetry)
        await Workers.Opfs.write(ProjectPaths.projectFile(uuid), new Uint8Array(projectArrayBuffer))
        await Workers.Opfs.write(ProjectPaths.projectMeta(uuid), new Uint8Array(metaArrayBuffer))
        const hasCover = files.some(file => file.endsWith("image.bin"))
        if (hasCover) {
            const arrayBuffer = await Promises.guardedRetry(() =>
                this.#cloudHandler.download(coverPath), network.defaultRetry)
            await Workers.Opfs.write(ProjectPaths.projectCover(uuid), new Uint8Array(arrayBuffer))
        }
        return true
    }

    /**
     * The catalog is shared by every device. Another device may have changed it since this sync began, so the
     * current one is read again right before it is written, and only this sync's own changes are applied to it.
     */
    async #updateCatalog(changed: Projects, removed: ReadonlyArray<UUID.String>): Promise<void> {
        this.#log("Uploading project catalog...")
        const latest = await downloadCatalog(this.#cloudHandler).catch(() => this.#cloud)
        const catalog: Projects = {...latest, ...changed}
        removed.forEach(uuid => delete catalog[uuid])
        this.#cloud = catalog
        const jsonString = JSON.stringify(catalog, null, 2)
        const buffer = new TextEncoder().encode(jsonString).buffer
        return this.#cloudHandler.upload(CloudBackupProjects.RemoteCatalogPath, buffer)
    }
}
