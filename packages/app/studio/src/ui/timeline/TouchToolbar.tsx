import css from "./TouchToolbar.sass?inline"
import {Lifecycle} from "@opendaw/lib-std"
import {createElement} from "@opendaw/lib-jsx"
import {Html} from "@opendaw/lib-dom"
import {AppUpdate} from "@/AppUpdate"
import {EditTool, TouchModifiers} from "./TouchModifiers"

const className = Html.adoptStyleSheet(css, "TouchToolbar")

// Tools stay selected until another one is picked: they change what the next touch on a region does.
const Tools: ReadonlyArray<{ tool: EditTool, label: string, title: string }> = [
    {tool: "move", label: "Move", title: "Tap selects, drag moves"},
    {tool: "multi", label: "Multi", title: "Tap or drag to add to the selection"},
    {tool: "duplicate", label: "Dup", title: "Drag a region to leave a copy behind"},
    {tool: "split", label: "Split", title: "Tap a region to cut it in two at that point"}
]

export type TouchActions = {
    // clipboard: the selected regions are held until pasted at the play position
    cut: () => void
    copy: () => void
    paste: () => void
    // removes the selected regions
    remove: () => void
}

type Construct = {
    lifecycle: Lifecycle
    actions: TouchActions
}

const buildName: string = `v${String(import.meta.env.BUILD_UUID ?? "dev").slice(0, 6)}`
const DebugKey = "touchdebug"

// Phone fork: picks the region tool that the Shift, Ctrl and Alt keys select on a desktop (see TouchModifiers),
// runs the clipboard actions, and tells which build is running.
export const TouchToolbar = ({lifecycle, actions}: Construct) => {
    const buttons = new Map<EditTool, HTMLElement>()
    const element: HTMLElement = <div className={className}/>
    Tools.forEach(({tool, label, title}) => {
        const button: HTMLElement = <button type="button" title={title} onclick={() => TouchModifiers.set(tool)}>{label}</button>
        buttons.set(tool, button)
        element.appendChild(button)
    })
    const action = (label: string, title: string, run: () => void, extra?: string): void => {
        const button: HTMLElement = <button type="button" className={extra ?? "action"} title={title} onclick={run}>{label}</button>
        if (extra === undefined) {button.classList.add("first")}
        element.appendChild(button)
    }
    action("Cut", "Cut the selected regions to the clipboard", actions.cut)
    action("Copy", "Copy the selected regions to the clipboard", actions.copy, "action")
    action("Paste", "Paste at the play position", actions.paste, "action")
    action("Delete", "Delete the selected regions", actions.remove, "action delete")

    // Which build is this? Five quick taps switch the touch debug panel on or off.
    let taps = 0
    let tapTimer: ReturnType<typeof setTimeout> | undefined
    const version: HTMLElement = <button type="button" className="version"
                                         title="Tap five times to switch the touch debug panel on or off"
                                         onclick={() => {
                                             taps++
                                             clearTimeout(tapTimer)
                                             tapTimer = setTimeout(() => {taps = 0}, 1500)
                                             if (taps < 5) {return}
                                             taps = 0
                                             try {
                                                 if (localStorage.getItem(DebugKey) === "1") {
                                                     localStorage.removeItem(DebugKey)
                                                 } else {
                                                     localStorage.setItem(DebugKey, "1")
                                                 }
                                             } catch (_error) {/* storage not available */}
                                             location.reload()
                                         }}>{buildName}</button>
    element.appendChild(version)

    const update: HTMLElement = <button type="button" className="update" title="A new version is ready"
                                        onclick={() => {
                                            if (window.confirm("Install the new version now? The page reloads.")) {AppUpdate.apply()}
                                        }}>Update</button>
    element.appendChild(update)

    const refresh = () => {
        buttons.forEach((button, tool) => button.classList.toggle("active", TouchModifiers.get() === tool))
        update.style.display = AppUpdate.isReady() ? "" : "none"
    }
    refresh()
    lifecycle.ownAll(TouchModifiers.subscribe(refresh), AppUpdate.subscribe(refresh))
    return element
}
