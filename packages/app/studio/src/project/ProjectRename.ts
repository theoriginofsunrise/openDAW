import {RuntimeNotifier, RuntimeSignal, UUID} from "@opendaw/lib-std"
import {Project, ProjectMeta, ProjectProfile, ProjectSignals, ProjectStorage} from "@opendaw/studio-core"
import type {StudioService} from "@/service/StudioService"

// Phone fork: renames a project that is stored on this device. The name lives in two places, in the metadata file
// and inside the project itself, and the project reads it back from inside, so the project is opened and saved.
export const renameProject = async (service: StudioService, uuid: UUID.Bytes, name: string): Promise<void> => {
    const trimmed = name.trim()
    if (trimmed.length === 0) {return}
    if (service.hasProfile && UUID.equals(service.profile.uuid, uuid)) {
        await RuntimeNotifier.info({
            headline: "Project is open",
            message: "Close the project first, then rename it."
        })
        return
    }
    const [buffer, metaBuffer, cover] = await Promise.all([
        ProjectStorage.loadProject(uuid),
        ProjectStorage.loadMeta(uuid),
        ProjectStorage.loadCover(uuid)
    ])
    const project = await Project.loadAnyVersion(service, buffer)
    try {
        const meta = ProjectMeta.fromJSON(JSON.parse(new TextDecoder().decode(metaBuffer)))
        const profile = new ProjectProfile(uuid, project, meta, cover, true)
        profile.updateMetaData("name", trimmed)
        await profile.save()
    } finally {
        project.terminate()
    }
    RuntimeSignal.dispatch(ProjectSignals.StorageUpdated)
}
