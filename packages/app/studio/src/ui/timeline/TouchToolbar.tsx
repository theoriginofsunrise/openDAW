import css from "./TouchToolbar.sass?inline"
import {Lifecycle} from "@opendaw/lib-std"
import {createElement} from "@opendaw/lib-jsx"
import {Html} from "@opendaw/lib-dom"
import {AppUpdate} from "@/AppUpdate"
import {EditTool, TouchModifiers} from "./TouchModifiers"
import {Insets, TouchToolbarPlacement} from "./TouchToolbarPlacement"

const className = Html.adoptStyleSheet(css, "TouchToolbar")

// Tools stay selected until another one is picked: they change what the next touch on a region does.
const Tools: ReadonlyArray<{ tool: EditTool, label: string, title: string }> = [
    {tool: "move", label: "Move", title: "Tap selects, drag moves"},
    {tool: "multi", label: "Multi", title: "Tap or drag to add to the selection"},
    {tool: "split", label: "Split", title: "Tap a region to cut it in two at that point"}
]

export type TouchActions = {
    // clipboard: the selected regions are held until pasted at the play position
    copy: () => void
    paste: () => void
    // removes the selected regions
    remove: () => void
    // opens this project as a live room: others join it with a link
    live?: () => void
}

type Construct = {
    lifecycle: Lifecycle
    actions: TouchActions
}

const PositionKey = "touch-toolbar-position"

// Phone fork: picks the region tool that the Shift and Alt keys select on a desktop (see TouchModifiers) and runs
// the clipboard actions. It floats: drag it by its grip to wherever it is out of the way, the place is remembered.
export const TouchToolbar = ({lifecycle, actions}: Construct) => {
    const buttons = new Map<EditTool, HTMLElement>()
    const grip: HTMLElement = <div className="grip" title="Drag to move the tool bar">⋮⋮</div>
    const element: HTMLElement = <div className={className}>{grip}</div>
    Tools.forEach(({tool, label, title}) => {
        // tapping the tool that is on switches it off: no tool selected = browse only, nothing can be changed
        const button: HTMLElement = <button type="button" title={`${title}. Tap again to switch it off.`}
                                            onclick={() => TouchModifiers.set(TouchModifiers.get() === tool ? "view" : tool)}>{label}</button>
        buttons.set(tool, button)
        element.appendChild(button)
    })
    const action = (label: string, title: string, run: () => void, extra: string): void => {
        const button: HTMLElement = <button type="button" className={extra} title={title} onclick={run}>{label}</button>
        element.appendChild(button)
    }
    action("Copy", "Copy the selected regions to the clipboard", actions.copy, "action first")
    action("Paste", "Paste at the play position", actions.paste, "action")
    action("Delete", "Delete the selected regions", actions.remove, "action delete")
    if (actions.live !== undefined) {
        action("Live", "Open this project as a live room, to work on it together", actions.live, "action live")
    }

    const update: HTMLElement = <button type="button" className="update" title="A new version is ready"
                                        onclick={() => {
                                            if (window.confirm("Install the new version now? The page reloads.")) {AppUpdate.apply()}
                                        }}>Update</button>
    element.appendChild(update)

    // --- floating: remember where it was put, keep its corner of the screen after a rotation, and keep the grip
    // reachable: away from the left edge (notch) and the bottom (home indicator), where a finger cannot get hold of it
    const screen = () => ({width: window.innerWidth, height: window.innerHeight})
    const measureInsets = (): Insets => {
        const probe = document.createElement("div")
        probe.style.cssText = "position:fixed;visibility:hidden;pointer-events:none;"
            + "padding:env(safe-area-inset-top,0px) 0 env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)"
        document.body.appendChild(probe)
        const style = getComputedStyle(probe)
        const insets = {
            top: parseFloat(style.paddingTop) || 0,
            left: parseFloat(style.paddingLeft) || 0,
            bottom: parseFloat(style.paddingBottom) || 0
        }
        probe.remove()
        return insets
    }
    const place = (left: number, top: number): void => {
        const {width, height} = element.getBoundingClientRect()
        const position = TouchToolbarPlacement.clampPosition(left, top, {width, height}, screen(), measureInsets())
        element.style.left = `${position.left}px`
        element.style.top = `${position.top}px`
        element.style.right = "auto"
        element.style.bottom = "auto"
    }
    // where the bar sits, as a share of the screen, so that a rotation moves it along with the screen
    let fraction: { x: number, y: number } | null = null
    const restore = (): void => {
        try {
            const saved = JSON.parse(localStorage.getItem(PositionKey) ?? "null")
            if (saved === null) {return}
            if (typeof saved.x === "number" && typeof saved.y === "number") {
                fraction = {x: saved.x, y: saved.y}
            } else if (typeof saved.left === "number" && typeof saved.top === "number") {
                fraction = TouchToolbarPlacement.toFraction(saved.left, saved.top, screen()) // saved by an older version
            }
            if (fraction !== null) {
                const {left, top} = TouchToolbarPlacement.fromFraction(fraction, screen())
                place(left, top)
            }
        } catch (_error) {/* nothing saved, or storage not available: keep the default corner */}
    }
    let drag: { x: number, y: number, left: number, top: number } | null = null
    const reshape = (): void => {
        if (fraction === null) {return}
        const {left, top} = TouchToolbarPlacement.fromFraction(fraction, screen())
        place(left, top)
    }
    // iOS reports the new screen size a moment after the rotation
    const afterRotation = (): void => {setTimeout(reshape, 300)}
    grip.addEventListener("pointerdown", (event: PointerEvent) => {
        event.preventDefault()
        event.stopPropagation()
        grip.setPointerCapture(event.pointerId)
        const {left, top} = element.getBoundingClientRect()
        drag = {x: event.clientX, y: event.clientY, left, top}
    })
    grip.addEventListener("pointermove", (event: PointerEvent) => {
        if (drag === null) {return}
        place(drag.left + event.clientX - drag.x, drag.top + event.clientY - drag.y)
    })
    const drop = (): void => {
        if (drag === null) {return}
        drag = null
        const {left, top} = element.getBoundingClientRect()
        fraction = TouchToolbarPlacement.toFraction(left, top, screen())
        try {localStorage.setItem(PositionKey, JSON.stringify(fraction))} catch (_error) {/* not saved */}
    }
    grip.addEventListener("pointerup", drop)
    grip.addEventListener("pointercancel", drop)
    window.addEventListener("resize", reshape)
    window.addEventListener("orientationchange", afterRotation)
    // once it is in the page it has a size, so the saved position can be clamped properly
    requestAnimationFrame(restore)

    const refresh = () => {
        buttons.forEach((button, tool) => button.classList.toggle("active", TouchModifiers.get() === tool))
        update.style.display = AppUpdate.isReady() ? "" : "none"
    }
    refresh()
    lifecycle.ownAll(
        TouchModifiers.subscribe(refresh),
        AppUpdate.subscribe(refresh),
        {
            terminate: () => {
                window.removeEventListener("resize", reshape)
                window.removeEventListener("orientationchange", afterRotation)
            }
        }
    )
    return element
}
