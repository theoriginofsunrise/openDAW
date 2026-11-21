export namespace ProjectSignals {
    export const StorageUpdated = Object.freeze({type: "project-storage-updated"})
    // a project was saved on this device (the person saved, or saved as)
    export const ProjectSaved = Object.freeze({type: "project-saved"})
    // a project was deleted on this device
    export const ProjectDeleted = Object.freeze({type: "project-deleted"})
}
