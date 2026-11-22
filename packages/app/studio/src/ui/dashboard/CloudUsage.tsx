import {createElement} from "@opendaw/lib-jsx"
import {Lifecycle, RuntimeNotifier, RuntimeSignal} from "@opendaw/lib-std"
import {Html} from "@opendaw/lib-dom"
import {EchoCloudHandler, EchoUsage, ProjectSignals} from "@opendaw/studio-core"
import {EchoSync} from "@/EchoSync"
import {detailsText, fractionUsed, levelOf, summaryText} from "@/ui/dashboard/UsageText"
import type {StudioService} from "@/service/StudioService"
import css from "./CloudUsage.sass?inline"

const className = Html.adoptStyleSheet(css, "CloudUsage")

type Construct = {
    lifecycle: Lifecycle
    service: StudioService
}

// Phone fork: how much of the free 10 GB of the storage server is used. It is the early warning for audio or projects
// that were made by mistake and sit there unseen: a tap lists where the space goes and the biggest files.
export const CloudUsage = ({lifecycle, service}: Construct) => {
    const auth = service.cloudAuthManager
    const label: HTMLElement = <span>Cloud storage</span>
    const fill: HTMLElement = <div className="fill"/>
    const button: HTMLElement = (
        <button type="button" className="unknown" title="How much of the free 10 GB is used. Tap for details." onclick={() => void details()}>
            {label}
            <div className="bar">{fill}</div>
        </button>
    )
    const root: HTMLElement = <div className={className}>{button}</div>
    let last: EchoUsage | null = null
    let timer: ReturnType<typeof setTimeout> | undefined

    const handler = (): EchoCloudHandler | null => {
        const peeked = auth.peekHandler("Echo")
        return peeked instanceof EchoCloudHandler ? peeked : null
    }

    const show = (usage: EchoUsage): void => {
        last = usage
        const fraction = fractionUsed(usage.total.bytes, usage.freeBytes)
        button.classList.remove("unknown", "ok", "warn", "full")
        button.classList.add(levelOf(fraction))
        fill.style.width = `${Math.min(100, fraction * 100)}%`
        label.textContent = `Cloud storage  ${summaryText(usage)}`
        button.title = `${summaryText(usage)} of the free storage. Tap for details.`
    }

    const refresh = async (fresh: boolean = false): Promise<void> => {
        const active = handler()
        // nobody is signed in: nothing to show (the Sync button asks for the login)
        root.style.display = active === null ? "none" : ""
        if (active === null) {return}
        try {
            show(await active.usage(fresh))
        } catch (error) {
            console.warn("Cloud usage unavailable", error)
            button.classList.add("unknown")
        }
    }

    const details = async (): Promise<void> => {
        await refresh(true)
        if (last === null) {return}
        // the names of the audio files, to tell which one is which
        const names: Record<string, string> = {}
        const active = handler()
        if (active !== null) {
            try {
                const catalog = JSON.parse(new TextDecoder().decode(await active.download("samples/index.json")))
                for (const sample of catalog as Array<{ uuid: string, name: string }>) {names[sample.uuid.toLowerCase()] = sample.name}
            } catch (_error) {/* the ids are shown instead */}
        }
        await RuntimeNotifier.info({headline: "Cloud storage", message: detailsText(last, names)})
    }

    const schedule = (): void => {
        clearTimeout(timer)
        timer = setTimeout(() => void refresh(), 1500)
    }
    const onVisible = (): void => {if (document.visibilityState === "visible") {schedule()}}
    const interval = setInterval(() => void refresh(), 5 * 60 * 1000)
    document.addEventListener("visibilitychange", onVisible)
    lifecycle.ownAll(
        auth.subscribeHandler(schedule),
        RuntimeSignal.subscribe(signal => signal === ProjectSignals.StorageUpdated && schedule()),
        {
            terminate: () => {
                clearInterval(interval)
                clearTimeout(timer)
                document.removeEventListener("visibilitychange", onVisible)
            }
        }
    )
    // a sync that ends may have added files: count again
    EchoSync.get()?.state.subscribe(owner => {if (owner.getValue() === "idle") {schedule()}})
    if (!auth.echoEnabled) {root.style.display = "none"}
    void refresh()
    return root
}
