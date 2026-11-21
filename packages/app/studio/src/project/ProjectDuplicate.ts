import {RuntimeNotifier, RuntimeSignal, UUID} from "@opendaw/lib-std"
import {Project, ProjectMeta, ProjectProfile, ProjectSignals, ProjectStorage} from "@opendaw/studio-core"
import type {StudioService} from "@/service/StudioService"
import {copyName} from "@/project/ProjectCopyName"

// Makes a new project from the stored version of a project, under a new identity. The copy is saved on this device
// and, with a storage server, goes up to it like any save.
export const duplicateProject = async (service: StudioService, uuid: UUID.Bytes): Promise<string | null> => {
    if (service.hasProfile && UUID.equals(service.profile.uuid, uuid) && service.profile.hasUnsavedChanges()) {
        const approved = await RuntimeNotifier.approve({
            headline: "Unsaved changes",
            message: "The copy is made from the saved version of the project, without the changes you have not saved yet.",
            approveText: "Copy saved version",
            cancelText: "Cancel"
        })
        if (!approved) {return null}
    }
    const [buffer, metaBuffer, cover, list] = await Promise.all([
        ProjectStorage.loadProject(uuid),
        ProjectStorage.loadMeta(uuid),
        ProjectStorage.loadCover(uuid),
        ProjectStorage.listProjects()
    ])
    const project = await Project.loadAnyVersion(service, buffer)
    try {
        const meta = ProjectMeta.fromJSON(JSON.parse(new TextDecoder().decode(metaBuffer)))
        const copyMeta = ProjectMeta.copy(meta)
        copyMeta.name = copyName(meta.name, list.map(entry => entry.meta.name))
        // The profile reads the old name back from the project itself, saveAs then writes the new one.
        const profile = new ProjectProfile(UUID.generate(), project, ProjectMeta.copy(meta), cover)
        await profile.saveAs(copyMeta)
        RuntimeSignal.dispatch(ProjectSignals.StorageUpdated)
        RuntimeSignal.dispatch(ProjectSignals.ProjectSaved)
        return copyMeta.name
    } finally {
        project.terminate()
    }
}
