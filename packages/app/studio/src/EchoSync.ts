import {RuntimeNotifier} from "@opendaw/lib-std"
import {CloudAuthManager, EchoAutoSync} from "@opendaw/studio-core"

// Phone fork: the automatic sync with our own storage server. Starts when the app starts (nothing happens in a build
// that has no server, or while nobody is signed in) and is reachable from the Sync button.
export namespace EchoSync {
    let current: EchoAutoSync | null = null

    export const install = (auth: CloudAuthManager): EchoAutoSync => {
        current = EchoAutoSync.create(auth, message => RuntimeNotifier.notify({message}))
        current.start()
        return current
    }

    export const get = (): EchoAutoSync | null => current
}
