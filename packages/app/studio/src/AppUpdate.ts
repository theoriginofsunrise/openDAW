// Phone fork: a new build is downloaded in the background, but the service worker only takes over on the next
// launch. A Home Screen app is rarely closed for real, so it can keep running an old build for days. This lets the
// tool bar offer "Update" as soon as a new build is ready.
export namespace AppUpdate {
    let waiting: ServiceWorker | null = null
    const observers = new Set<() => void>()

    export const isReady = (): boolean => waiting !== null

    export const subscribe = (observer: () => void): { terminate: () => void } => {
        observers.add(observer)
        return {terminate: () => {observers.delete(observer)}}
    }

    export const watch = (registration: ServiceWorkerRegistration): void => {
        const check = (): void => {
            // without a controller this is the very first install, there is nothing to replace
            if (registration.waiting === null || navigator.serviceWorker.controller === null) {return}
            waiting = registration.waiting
            observers.forEach(observer => observer())
        }
        check()
        registration.addEventListener("updatefound", () => {
            const worker = registration.installing
            worker?.addEventListener("statechange", () => {if (worker.state === "installed") {check()}})
        })
        // A suspended app does not look for updates by itself: ask again whenever it comes back to the front.
        document.addEventListener("visibilitychange", () => {
            if (document.visibilityState !== "visible") {return}
            registration.update().then(check, () => {})
        })
    }

    export const apply = (): void => {
        if (waiting === null) {return}
        navigator.serviceWorker.addEventListener("controllerchange", () => location.reload(), {once: true})
        waiting.postMessage("skip-waiting")
    }
}
