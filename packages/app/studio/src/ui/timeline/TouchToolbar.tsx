import css from "./TouchToolbar.sass?inline"
import {Lifecycle} from "@opendaw/lib-std"
import {createElement} from "@opendaw/lib-jsx"
import {Html} from "@opendaw/lib-dom"
import {EditTool, TouchModifiers} from "./TouchModifiers"

const className = Html.adoptStyleSheet(css, "TouchToolbar")

const Tools: ReadonlyArray<{ tool: EditTool, label: string, title: string }> = [
    {tool: "move", label: "Move", title: "Tap selects, drag moves"},
    {tool: "multi", label: "Multi", title: "Tap or drag to add to the selection"},
    {tool: "copy", label: "Copy", title: "Drag a region to copy it"},
    {tool: "cut", label: "Cut", title: "Tap a region to cut it at that point"}
]

type Construct = {
    lifecycle: Lifecycle
}

// Phone fork: picks the region tool that the Shift, Ctrl and Alt keys select on a desktop (see TouchModifiers).
export const TouchToolbar = ({lifecycle}: Construct) => {
    const buttons = new Map<EditTool, HTMLElement>()
    const element: HTMLElement = <div className={className}/>
    Tools.forEach(({tool, label, title}) => {
        const button: HTMLElement = <button type="button" title={title} onclick={() => TouchModifiers.set(tool)}>{label}</button>
        buttons.set(tool, button)
        element.appendChild(button)
    })
    const update = () => buttons.forEach((button, tool) => button.classList.toggle("active", TouchModifiers.get() === tool))
    update()
    lifecycle.own(TouchModifiers.subscribe(update))
    return element
}
