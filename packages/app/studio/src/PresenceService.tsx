import {createElement} from "@opendaw/lib-jsx"
import {Option, Terminable, Terminator, UUID} from "@opendaw/lib-std"
import {CloudAuthManager, CloudPresence, PresenceNote, ProjectProfile} from "@opendaw/studio-core"
import {IconSymbol} from "@opendaw/studio-enums"
import {Dialog} from "@/ui/components/Dialog"
import {Surface} from "@/ui/surface/Surface"
import type {StudioService} from "@/service/StudioService"

// Phone fork: tells you when the project you have open is open on another device too.
//
// While a project is open and the cloud login is valid, this device keeps a small note about it in the cloud and
// looks for the notes of other devices once a minute. It never opens a login window by itself: without a valid
// login (it lasts about an hour after pressing Drive) nothing is checked and nothing is written. The warning is a
// courtesy; the real protection is the sync, which asks before it replaces anything.
export namespace PresenceService {
    type Session = {
        readonly profile: ProjectProfile
        readonly uuid: UUID.String
        readonly since: string
        // devices that were already warned about, so each is mentioned once per opening
        readonly warned: Set<string>
    }

    export const install = (service: StudioService, auth: CloudAuthManager): Terminable => {
        const lifecycle = new Terminator()
        let session: Session | null = null
        let busy = false

        const minutesAgo = (note: PresenceNote): string => {
            const minutes = Math.floor((Date.now() - new Date(note.seen).getTime()) / 60_000)
            return minutes < 1 ? "a moment ago" : minutes === 1 ? "1 minute ago" : `${minutes} minutes ago`
        }

        const warn = (note: PresenceNote, name: string): void => {
            const dialog: HTMLDialogElement = (
                <Dialog headline="Open on another device"
                        icon={IconSymbol.System}
                        cancelable={true}
                        buttons={[
                            {text: "Close project", onClick: handler => {handler.close(); void service.closeProject()}},
                            {text: "Keep it open", primary: true, onClick: handler => handler.close()}
                        ]}>
                    <div style={{padding: "1em 0", maxWidth: "30em", lineHeight: "1.5"}}>
                        <p><b>{name}</b></p>
                        <p>{`${note.device} has this project open too (active ${minutesAgo(note)}).`}</p>
                        <p>If both of you save, the one who syncs second is asked how to combine the two versions.
                            Nothing is replaced without asking.</p>
                    </div>
                </Dialog>
            )
            Surface.get().flyout.appendChild(dialog)
            dialog.showModal()
        }

        const tick = async (): Promise<void> => {
            const current = session
            const handler = auth.peekHandler(auth.echoEnabled ? "Echo" : undefined)
            if (current === null || handler === null || busy) {return}
            busy = true
            try {
                const others = await CloudPresence.others(handler, current.uuid)
                const unannounced = others.filter(note => !current.warned.has(note.session))
                unannounced.forEach(note => current.warned.add(note.session))
                if (unannounced.length > 0 && session === current) {warn(unannounced[0], current.profile.meta.name)}
                if (session === current) {
                    await CloudPresence.renew(handler, current.uuid, current.profile.meta.name, current.since)
                }
            } catch (error) {
                console.warn("Presence update failed", error)
            } finally {
                busy = false
            }
        }

        const begin = (optProfile: Option<ProjectProfile>): void => {
            const previous = session
            session = null
            const handler = auth.peekHandler(auth.echoEnabled ? "Echo" : undefined)
            if (previous !== null && handler !== null) {void CloudPresence.clear(handler, previous.uuid)}
            if (optProfile.isEmpty()) {return}
            const profile = optProfile.unwrap()
            session = {profile, uuid: UUID.toString(profile.uuid), since: new Date().toISOString(), warned: new Set()}
            void tick()
        }

        const onVisible = (): void => {if (document.visibilityState === "visible") {void tick()}}
        const timer = setInterval(() => void tick(), CloudPresence.HeartbeatMs)
        document.addEventListener("visibilitychange", onVisible)
        lifecycle.ownAll(
            service.projectProfileService.catchupAndSubscribe(begin),
            // a login just succeeded (the Drive button): look right away
            auth.subscribeHandler(() => void tick()),
            {
                terminate: () => {
                    clearInterval(timer)
                    document.removeEventListener("visibilitychange", onVisible)
                }
            }
        )
        return lifecycle
    }
}
