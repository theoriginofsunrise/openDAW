import {createElement} from "@opendaw/lib-jsx"
import {UUID} from "@opendaw/lib-std"
import {Promises} from "@opendaw/lib-runtime"
import {
    CloudSyncHooks,
    ConflictChoice,
    ConflictInfo,
    Project,
    ProjectMeta,
    ProjectProfile,
    ProjectStorage
} from "@opendaw/studio-core"
import {IconSymbol} from "@opendaw/studio-enums"
import {Dialog} from "@/ui/components/Dialog"
import {Surface} from "@/ui/surface/Surface"
import type {StudioService} from "@/service/StudioService"

// Phone fork: what the cloud sync asks, and how it answers, when a project was changed in two places.
export namespace CloudSafety {
    export const install = (service: StudioService): void => {
        CloudSyncHooks.install({
            resolveConflict: showConflict,
            isProjectOpen: uuid => service.hasProfile && UUID.toString(service.profile.uuid) === uuid,
            createConflictCopy: uuid => createConflictCopy(service, uuid)
        })
    }

    const showTime = (iso: string): string => new Date(iso).toLocaleString()

    const showConflict = (info: ConflictInfo): Promise<ConflictChoice> => {
        const {resolve, promise} = Promise.withResolvers<ConflictChoice>()
        const answer = (choice: ConflictChoice) => (handler: { close(): void }) => {
            resolve(choice)
            handler.close()
        }
        const why = info.reason === "both-changed"
            ? "It was saved on this device and, since the last sync, also somewhere else."
            : "This device has no record of syncing it before, so it cannot tell which copy is the newer work."
        const dialog: HTMLDialogElement = (
            <Dialog headline="Two versions of a project"
                    icon={IconSymbol.System}
                    cancelable={true}
                    onCancel={() => resolve("skip")}
                    buttons={[
                        {text: "Skip", onClick: answer("skip")},
                        {text: "Use cloud", onClick: answer("use-cloud")},
                        {text: "Use mine", onClick: answer("use-mine")},
                        {text: "Keep both", primary: true, onClick: answer("keep-both")}
                    ]}>
                <div style={{padding: "1em 0", maxWidth: "30em", lineHeight: "1.5"}}>
                    <p><b>{info.name}</b></p>
                    <p>{why}</p>
                    <p>{`This device: saved ${showTime(info.local)}`}<br/>{`Cloud: saved ${showTime(info.cloud)}`}</p>
                    {info.open && <p>It is open on this device right now, so only Skip and Use mine can change it.</p>}
                    <p><b>Keep both</b> saves your version as a new project and takes the cloud version.
                        <br/><b>Use cloud</b> drops your changes.
                        <br/><b>Use mine</b> replaces the cloud version.
                        <br/><b>Skip</b> changes nothing and asks again next time.</p>
                </div>
            </Dialog>
        )
        Surface.get().flyout.appendChild(dialog)
        dialog.showModal()
        return promise
    }

    // Saves this device's stored version as a new project, so that it survives when the cloud version takes over.
    const createConflictCopy = async (service: StudioService, uuidAsString: UUID.String): Promise<string> => {
        const uuid = UUID.parse(uuidAsString)
        const [buffer, metaBuffer, cover] = await Promise.all([
            ProjectStorage.loadProject(uuid),
            ProjectStorage.loadMeta(uuid),
            ProjectStorage.loadCover(uuid)
        ])
        const project = await Project.loadAnyVersion(service, buffer)
        try {
            const meta = ProjectMeta.fromJSON(JSON.parse(new TextDecoder().decode(metaBuffer)))
            const stamp = new Date().toISOString().slice(0, 16).replace("T", " ")
            const copyMeta = ProjectMeta.copy(meta)
            copyMeta.name = `${meta.name} (my version ${stamp})`
            // The profile reads the old name back from the project itself, saveAs then writes the new one.
            const profile = new ProjectProfile(UUID.generate(), project, ProjectMeta.copy(meta), cover)
            const {status, error} = await Promises.tryCatch(profile.saveAs(copyMeta))
            if (status === "rejected") {return Promise.reject(error)}
            return copyMeta.name
        } finally {
            project.terminate()
        }
    }
}
