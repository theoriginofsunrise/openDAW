// How far the offline copy of the app on this device is, asked of the service worker that controls the page.
export namespace OfflineStatus {
    export type Status = { build: string, cached: number, total: number }

    export const read = (timeoutMs: number = 2500): Promise<Status | null> => new Promise(resolve => {
        const controller = typeof navigator !== "undefined" && "serviceWorker" in navigator
            ? navigator.serviceWorker.controller : null
        if (controller === null) {
            resolve(null)
            return
        }
        const channel = new MessageChannel()
        const timer = setTimeout(() => resolve(null), timeoutMs)
        channel.port1.onmessage = event => {
            clearTimeout(timer)
            resolve(event.data as Status)
        }
        controller.postMessage({type: "status"}, [channel.port2])
    })
}
